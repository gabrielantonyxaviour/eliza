import {
    parseBooleanFromText,
    parseJsonArrayFromText,
    parseJSONObjectFromText,
    parseShouldRespondFromText,
} from "./parsing.ts";
import { Content, IAgentRuntime, ModelProvider } from "./types.ts";

import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { default as tiktoken, TiktokenModel } from "tiktoken";
import models from "./models.ts";

import { generateText as aiGenerateText } from "ai";
import ollama from 'ollama'

import { createAnthropic } from "@ai-sdk/anthropic";
import { prettyConsole } from "../index.ts";

/**
 * Send a message to the model for a text generateText - receive a string back and parse how you'd like
 * @param opts - The options for the generateText request.
 * @param opts.context The context of the message to be completed.
 * @param opts.stop A list of strings to stop the generateText at.
 * @param opts.model The model to use for generateText.
 * @param opts.frequency_penalty The frequency penalty to apply to the generateText.
 * @param opts.presence_penalty The presence penalty to apply to the generateText.
 * @param opts.temperature The temperature to apply to the generateText.
 * @param opts.max_context_length The maximum length of the context to apply to the generateText.
 * @returns The completed message.
 */

export async function generateText({
    runtime,
    context,
    modelClass,
    stop,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
    stop?: string[];
}): Promise<string> {
    if (!context) {
        console.error("generateText context is empty");
        return "";
    }

    const provider = runtime.modelProvider;
    const model = models[provider].model[modelClass];
    const temperature = models[provider].settings.temperature;
    const frequency_penalty = models[provider].settings.frequency_penalty;
    const presence_penalty = models[provider].settings.presence_penalty;
    const max_context_length = models[provider].settings.maxInputTokens;
    const max_response_length = models[provider].settings.maxOutputTokens;

    const apiKey = runtime.token;

    try {
        prettyConsole.log(
            `Trimming context to max length of ${max_context_length} tokens.`
        );
        context = await trimTokens(context, max_context_length, "gpt-4o");

        let response: string;

        const _stop = stop || models[provider].settings.stop;
        prettyConsole.log(
            `Using provider: ${provider}, model: ${model}, temperature: ${temperature}, max response length: ${max_response_length}`
        );

        switch (provider) {
            case ModelProvider.HEURIST:
                prettyConsole.log("Initializing Heurist model.");
                const openai = createOpenAI({
                    apiKey,
                    baseURL: "https://llm-gateway.heurist.xyz",
                });

                const { text: openaiResponse } = await aiGenerateText({
                    model: openai.languageModel(model),
                    prompt: context,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = openaiResponse;
                prettyConsole.log("Received response from OpenAI model.");
                break;
            case ModelProvider.OPENAI:
            case ModelProvider.LLAMACLOUD: {
                prettyConsole.log("Initializing OpenAI model.");
                const openai = createOpenAI({ apiKey });


                const { text: openaiResponse } = await aiGenerateText({
                    model: openai.languageModel(model),
                    prompt: context,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = openaiResponse;
                prettyConsole.log("Received response from OpenAI model.");
                break;
            }
            case ModelProvider.DEEPSEEK:
                prettyConsole.log("Using DeepSeek model for text completion.");
                response = (await ollama.chat({
                    model,
                    messages: [{ role: "user", content: context }],
                    options: {
                        num_predict: max_response_length,
                        temperature: temperature,
                        frequency_penalty: frequency_penalty,
                        presence_penalty: presence_penalty,
                    }
                })).message.content;
                prettyConsole.log("Received response from DeepSeek model.");
                break;
            case ModelProvider.ANTHROPIC: {
                prettyConsole.log("Initializing Anthropic model.");

                const anthropic = createAnthropic({ apiKey });

                const { text: anthropicResponse } = await aiGenerateText({
                    model: anthropic.languageModel(model),
                    prompt: context,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = anthropicResponse;
                prettyConsole.log("Received response from Anthropic model.");
                break;
            }

            case ModelProvider.GROK: {
                prettyConsole.log("Initializing Grok model.");
                const grok = createGroq({ apiKey });

                const { text: grokResponse } = await aiGenerateText({
                    model: grok.languageModel(model, {
                        parallelToolCalls: false,
                    }),
                    prompt: context,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = grokResponse;
                prettyConsole.log("Received response from Grok model.");
                break;
            }

            case ModelProvider.LLAMALOCAL:
                prettyConsole.log(
                    "Using local Llama model for text completion."
                );
                response = await runtime.llamaService.queueTextCompletion(
                    context,
                    temperature,
                    _stop,
                    frequency_penalty,
                    presence_penalty,
                    max_response_length
                );
                prettyConsole.log("Received response from local Llama model.");
                break;


            default: {
                const errorMessage = `Unsupported provider: ${provider}`;
                prettyConsole.error(errorMessage);
                throw new Error(errorMessage);
            }
        }

        return response;
    } catch (error) {
        prettyConsole.error("Error in generateText:", error);
        throw error;
    }
}

/**
 * Truncate the context to the maximum length allowed by the model.
 * @param model The model to use for generateText.
 * @param context The context of the message to be completed.
 * @param max_context_length The maximum length of the context to apply to the generateText.
 * @returns
 */
export function trimTokens(context, maxTokens, model) {
    // Count tokens and truncate context if necessary
    const encoding = tiktoken.encoding_for_model(model as TiktokenModel);
    let tokens = encoding.encode(context);
    const textDecoder = new TextDecoder();
    if (tokens.length > maxTokens) {
        tokens = tokens.reverse().slice(maxTokens).reverse();

        context = textDecoder.decode(encoding.decode(tokens));
    }
    return context;
}
/**
 * Sends a message to the model to determine if it should respond to the given context.
 * @param opts - The options for the generateText request
 * @param opts.context The context to evaluate for response
 * @param opts.stop A list of strings to stop the generateText at
 * @param opts.model The model to use for generateText
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to "RESPOND", "IGNORE", "STOP" or null
 */
export async function generateShouldRespond({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
    let retryDelay = 1000;
    while (true) {
        try {
            prettyConsole.log(
                "Attempting to generate text with context:",
                context
            );
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            prettyConsole.log("Received response from generateText:", response);
            const parsedResponse = parseShouldRespondFromText(response.trim());
            if (parsedResponse) {
                prettyConsole.log("Parsed response:", parsedResponse);
                return parsedResponse;
            } else {
                prettyConsole.log("generateShouldRespond no response");
            }
        } catch (error) {
            prettyConsole.error("Error in generateShouldRespond:", error);
            if (
                error instanceof TypeError &&
                error.message.includes("queueTextCompletion")
            ) {
                prettyConsole.error(
                    "TypeError: Cannot read properties of null (reading 'queueTextCompletion')"
                );
            }
        }

        prettyConsole.log(`Retrying in ${retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Splits content into chunks of specified size with optional overlapping bleed sections
 * @param content - The text content to split into chunks
 * @param chunkSize - The maximum size of each chunk in tokens
 * @param bleed - Number of characters to overlap between chunks (default: 100)
 * @param model - The model name to use for tokenization (default: runtime.model)
 * @returns Promise resolving to array of text chunks with bleed sections
 */
export async function splitChunks(
    runtime,
    content: string,
    chunkSize: number,
    bleed: number = 100,
    modelClass: string
): Promise<string[]> {
    const model = runtime.model[modelClass];
    const encoding = tiktoken.encoding_for_model(
        model.model.embedding as TiktokenModel
    );
    const tokens = encoding.encode(content);
    const chunks: string[] = [];
    const textDecoder = new TextDecoder();

    for (let i = 0; i < tokens.length; i += chunkSize) {
        const chunk = tokens.slice(i, i + chunkSize);
        const decodedChunk = textDecoder.decode(encoding.decode(chunk));

        // Append bleed characters from the previous chunk
        const startBleed = i > 0 ? content.slice(i - bleed, i) : "";
        // Append bleed characters from the next chunk
        const endBleed =
            i + chunkSize < tokens.length
                ? content.slice(i + chunkSize, i + chunkSize + bleed)
                : "";

        chunks.push(startBleed + decodedChunk + endBleed);
    }

    return chunks;
}

/**
 * Sends a message to the model and parses the response as a boolean value
 * @param opts - The options for the generateText request
 * @param opts.context The context to evaluate for the boolean response
 * @param opts.stop A list of strings to stop the generateText at
 * @param opts.model The model to use for generateText
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.token The API token for authentication
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to a boolean value parsed from the model's response
 */
export async function generateTrueOrFalse({
    runtime,
    context = "",
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<boolean> {
    let retryDelay = 1000;

    const stop = Array.from(
        new Set([...(models[modelClass].settings.stop || []), ["\n"]])
    ) as string[];

    while (true) {
        try {
            const response = await generateText({
                stop,
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseBooleanFromText(response.trim());
            if (parsedResponse !== null) {
                return parsedResponse;
            }
        } catch (error) {
            prettyConsole.error("Error in generateTrueOrFalse:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Send a message to the model and parse the response as a string array
 * @param opts - The options for the generateText request
 * @param opts.context The context/prompt to send to the model
 * @param opts.stop Array of strings that will stop the model's generation if encountered
 * @param opts.model The language model to use
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.token The API token for authentication
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to an array of strings parsed from the model's response
 */
export async function generateTextArray({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<string[]> {
    if (!context) {
        prettyConsole.error("generateTextArray context is empty");
        return [];
    }
    let retryDelay = 1000;

    while (true) {
        try {
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseJsonArrayFromText(response);
            if (parsedResponse) {
                return parsedResponse;
            }
        } catch (error) {
            prettyConsole.error("Error in generateTextArray:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

export async function generateObjectArray({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<any[]> {
    if (!context) {
        prettyConsole.error("generateObjectArray context is empty");
        return [];
    }
    let retryDelay = 1000;

    while (true) {
        try {
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseJsonArrayFromText(response);
            if (parsedResponse) {
                return parsedResponse;
            }
        } catch (error) {
            prettyConsole.error("Error in generateTextArray:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Send a message to the model for generateText.
 * @param opts - The options for the generateText request.
 * @param opts.context The context of the message to be completed.
 * @param opts.stop A list of strings to stop the generateText at.
 * @param opts.model The model to use for generateText.
 * @param opts.frequency_penalty The frequency penalty to apply to the generateText.
 * @param opts.presence_penalty The presence penalty to apply to the generateText.
 * @param opts.temperature The temperature to apply to the generateText.
 * @param opts.max_context_length The maximum length of the context to apply to the generateText.
 * @returns The completed message.
 */
export async function generateMessageResponse({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<Content> {
    const max_context_length =
        models[runtime.modelProvider].settings.maxInputTokens;
    context = trimTokens(context, max_context_length, "gpt-4o");
    let retryLength = 1000; // exponential backoff
    while (true) {
        try {
            console.log("Generation Prompt")
            console.log(context)
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            console.log("Response from AI for Generate Operation")
            console.log(response)
            // try parsing the response as JSON, if null then try again
            const parsedContent = parseJSONObjectFromText(response) as Content;
            if (!parsedContent) {
                prettyConsole.log("parsedContent is null, retrying");
                continue;
            }

            return parsedContent;
        } catch (error) {
            prettyConsole.error("ERROR:", error);
            // wait for 2 seconds
            retryLength *= 2;
            await new Promise((resolve) => setTimeout(resolve, retryLength));
            prettyConsole.log("Retrying...");
        }
    }
}
