import { SearchMode, Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import { log_to_file } from "../../core/logger.ts";
import {
    messageCompletionFooter,
    parseJsonArrayFromText,
} from "../../core/parsing.ts";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    ModelClass,
    State,
} from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { buildConversationThread, likeTweet, retweet, sendQuoteTweetChunks, sendTweetChunks, wait } from "./utils.ts";
import {
    generateMessageResponse,
    generateText,
} from "../../core/generation.ts";
import { TikTokProvider } from "../../providers/tiktok.ts";

const replyHandlerTemplate =
    `
About {{agentName}}:
{{bio}}
{{lore}}

{{recentPosts}}

# Task: Respond to the following post in the style and perspective of {{agentName}} (aka @{{twitterUserName}}).
{{currentPost}}

{{tokenProviderData}}

{{exampleData}}

IMPORTANT: Your response CANNOT be longer than 20 words.
Aim for 1-2 short sentences maximum. Be concise and direct. only loqercase. rarely use emojis. no hashtags. Your response should not contain any questions. 

Use \\n\\n (double spaces) between statements ONLY IF token data is present.
`

const quoteHandlerTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{recentPosts}}

# Task: Generate a retweet to the following post with a quote in the style and perspective of {{agentName}} (aka @{{twitterUserName}}).
{{currentPost}}

{{tokenProviderData}}

{{exampleData}}

IMPORTANT: Your response CANNOT be longer than 20 words.
Aim for 1-2 short sentences maximum. Be concise and direct. only loqercase. rarely use emojis. no hashtags. Your response should not contain any questions. 

Use \\n\\n (double spaces) between statements ONLY IF token data is present.
` + messageCompletionFooter;



export class TwitterInteractionClient extends ClientBase {
    onReady() {
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            setTimeout(
                handleTwitterInteractionsLoop,
                (Math.floor(Math.random() * (5 - 2 + 1)) + 2) * 60 * 1000
            ); // Random interval between 2-5 minutes
        };
        handleTwitterInteractionsLoop();
    }

    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
    }

    async handleTwitterInteractions() {
        console.log("Checking Twitter interactions");
        try {
            // Check for mentions
            const tweetCandidates = (
                await this.fetchSearchTweets(
                    `@${this.runtime.getSetting("TWITTER_USERNAME")}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            // de-duplicate tweetCandidates with a set
            const uniqueTweetCandidates = [...new Set(tweetCandidates)];

            // Sort tweet candidates by ID in ascending order
            uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.twitterUserId)
            console.log("Unique Tweet Candidates")
            console.log(uniqueTweetCandidates)
            if (uniqueTweetCandidates.length === 0) {
                console.log("No tweet candidates found in the interactoins for: " + `@${this.runtime.getSetting("TWITTER_USERNAME")}`);
                return;
            }
            const prompt = `${uniqueTweetCandidates.map(
                (tweet) => `
ID: ${tweet.id}${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}
From: ${tweet.name} (@${tweet.username})
Text: ${tweet.text}
`
            )
                .join("\n")}
            
            About ${this.runtime.character.name}:
${Array.isArray(this.runtime.character.bio) ? this.runtime.character.bio.join("\n") : this.runtime.character.bio}\n
${Array.isArray(this.runtime.character.lore) ? this.runtime.character.lore.join("\n") : this.runtime.character.lore}

# Instruction: You need to decide one of the 5 actions for each tweet in your comment section.

Action Guidelines:
- REPLY: Choose when you can add value to the conversation or have a meaningful exchange
- QUOTE: Use when you want to add commentary while sharing the tweet with your followers. 
- LIKE: For tweets you agree with but don't require direct engagement.
- RETWEET: For tweets that align with your values and you want to amplify.
- IGNORE: When unintersting to ${this.runtime.character.name}'s lore, irrelevant, spam, or inappropriate content. 

Note: Don't maintain long conversations. You don't have to repl

Selection Criteria:
- Prioritize English tweets
- Avoid tweets with excessive hashtags, links, or media
- Skip retweets
- Focus on tweets that enable meaningful engagement
- Consider your character's personality and interests
- Prefer tweets that are part of active discussions

Please analyze each tweet and return ONLY ONE action per tweet in the specified JSON format.

\`\`\`json
{
  "tweetId": "1234567890",
  "action": "REPLY"
}[]
\`\`\`

            `

            const datestr = new Date().toUTCString().replace(/:/g, "-");
            const logName = `${this.runtime.character.name}_interactions_${datestr}`;
            // log_to_file(logName, prompt);
            let parsedContent: { tweetId: string, action: string }[] = [];
            while (true) {
                console.log("Interactoin prompt")
                console.log(prompt)
                const interactionDecisionResponse = await generateText({
                    runtime: this.runtime,
                    context: prompt,
                    modelClass: ModelClass.SMALL,
                });
                console.log("Response from AI for Interaction Operation")
                console.log(interactionDecisionResponse)

                const responseLogName = `${this.runtime.character.name}_interactions_${datestr}_result`;
                // log_to_file(responseLogName, interactionDecisionResponse);
                parsedContent = parseJsonArrayFromText(interactionDecisionResponse) as { tweetId: string, action: string }[]
                if (!parsedContent) {
                    console.log("parsedContent is null, retrying");
                    continue;
                }
                break;
            }

            for (const tweet of parsedContent) {
                const selectedTweet = uniqueTweetCandidates.find((t) => t.id === tweet.tweetId);
                if (!selectedTweet) {
                    console.log("No matching tweet found for the selected ID");
                    continue;
                }
                if (selectedTweet.username === this.runtime.getSetting("TWITTER_USERNAME")) {
                    console.log("Skipping tweet from bot itself");
                    continue;
                }

                if (tweet.action === "IGNORE") continue;
                else if (tweet.action === "LIKE")
                    await likeTweet(this, tweet.tweetId)
                else if (tweet.action === "RETWEET") await retweet(this, tweet.tweetId);
                else if (tweet.action === "REPLY" || tweet.action === "QUOTE") {
                    const conversationId = selectedTweet.conversationId;
                    const roomId = stringToUuid(conversationId);

                    const userIdUUID = stringToUuid(selectedTweet.userId as string);
                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        selectedTweet.username,
                        selectedTweet.name,
                        "twitter"
                    );
                    // crawl additional conversation tweets, if there are any
                    await buildConversationThread(selectedTweet, this);
                    const message = {
                        id: stringToUuid(selectedTweet.id),
                        agentId: this.runtime.agentId,
                        content: {
                            text: selectedTweet.text,
                            url: selectedTweet.permanentUrl,
                            inReplyTo: selectedTweet.inReplyToStatusId
                                ? stringToUuid(selectedTweet.inReplyToStatusId)
                                : undefined,
                        },
                        userId: userIdUUID,
                        roomId,
                        // Timestamps are in seconds, but we need them in milliseconds
                        createdAt: selectedTweet.timestamp * 1000,
                    };
                    if (!message.content.text) {
                        return { text: "", action: "IGNORE" };
                    }
                    let homeTimeline = [];
                    // read the file if it exists
                    if (fs.existsSync("tweetcache/home_timeline.json")) {
                        homeTimeline = JSON.parse(
                            fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
                        );
                    } else {
                        homeTimeline = await this.fetchHomeTimeline(50);
                        fs.writeFileSync(
                            "tweetcache/home_timeline.json",
                            JSON.stringify(homeTimeline, null, 2)
                        );
                    }

                    const formattedHomeTimeline =
                        `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                        homeTimeline
                            .map((tweet) => {
                                return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                            })
                            .join("\n");

                    // Fetch replies and retweets
                    const replies = selectedTweet.thread;
                    const replyContext = replies
                        .filter(
                            (reply) =>
                                reply.username !==
                                this.runtime.getSetting("TWITTER_USERNAME")
                        )
                        .map((reply) => `@${reply.username}: ${reply.text}`)
                        .join("\n");

                    let tweetBackground = "";
                    if (selectedTweet.isRetweet) {
                        const originalTweet = await this.requestQueue.add(() =>
                            this.twitterClient.getTweet(selectedTweet.id)
                        );
                        tweetBackground = `Retweeting @${originalTweet.username}: ${originalTweet.text}`;
                    }

                    // Generate image descriptions using GPT-4 vision API
                    const imageDescriptions = [];
                    for (const photo of selectedTweet.photos) {
                        const description =
                            await this.runtime.imageDescriptionService.describeImage(
                                photo.url
                            );
                        imageDescriptions.push(description);
                    }
                    let tokenProviderData: string = ''
                    const tiktokProvider = new TikTokProvider(this.runtime)
                    // Identify ticker
                    const tickerMentions = selectedTweet.text.match(/\$[A-Za-z0-9]+/g) || [];
                    const addressMentions = selectedTweet.text.match(/(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})/g) || [];
                    const mentions = [...tickerMentions, ...addressMentions];
                    if (mentions.length > 0)
                        tokenProviderData = await tiktokProvider.getTokenDataByTicker(mentions)
                    let state = await this.runtime.composeState(message, {
                        twitterClient: this.twitterClient,
                        twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                        timeline: formattedHomeTimeline,
                        tweetContext: `${tweetBackground}
          
          Original Post:
          By @${selectedTweet.username}
          ${selectedTweet.text}${replyContext.length > 0 && `\nReplies to original post:\n${replyContext}`}
          ${`Original post text: ${selectedTweet.text}`}
          ${selectedTweet.urls.length > 0 ? `URLs: ${selectedTweet.urls.join(", ")}\n` : ""}${imageDescriptions.length > 0 ? `\nImages in Post (Described): ${imageDescriptions.join(", ")}\n` : ""}
          `,
                        kind: tokenProviderData.length == 0 ? 'random' : 'default',
                    });
                    const tweetId = stringToUuid(selectedTweet.id);
                    const tweetExists =
                        await this.runtime.messageManager.getMemoryById(tweetId);

                    if (!tweetExists)
                        await this.saveRequestMessage(message, state as State);

                    const context = composeContext({
                        state: { ...state, tokenProviderData: tokenProviderData.length == 0 ? tokenProviderData : "No token mention present", exampleData: tokenProviderData.length == 0 ? state.dataExamples : state.randomExamples },
                        template: tweet.action == "REPLY" ? replyHandlerTemplate : quoteHandlerTemplate,
                    });
                    const promptFilePath = `interactions_context_${Date.now()}.txt`;
                    fs.writeFileSync(promptFilePath, context.trim(), "utf8");
                    console.log(`Prompt saved to ${promptFilePath}`);
                    // log context to file
                    // log_to_file(
                    //     `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_interactions_context`,
                    //     context
                    // );

                    const responseContent = await generateMessageResponse({
                        runtime: this.runtime,
                        context,
                        modelClass: ModelClass.SMALL,
                    });
                    responseContent.inReplyTo = tweet.action == "REPLY" ? message.id : undefined;
                    responseContent.inQuoteTo = tweet.action == "QUOTE" ? message.id : undefined;

                    // log_to_file(
                    //     `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_interactions_response`,
                    //     JSON.stringify(responseContent)
                    // );

                    const response = responseContent;

                    const responseFilePath = `interactions_response_${Date.now()}.txt`;
                    fs.writeFileSync(responseFilePath, response.text, "utf8");
                    console.log(`Response saved`);

                    if (!response.text) {
                        console.log("Returning: No response text found");
                        return;
                    }

                    console.log(
                        `Bot would ${tweet.action == 'QUOTE' ? 'quote' : "reply"} to tweet ${selectedTweet.id} with: ${response.text}`
                    );

                    try {
                        const callback: HandlerCallback = tweet.action == 'QUOTE' ? async (response: Content) => {
                            const memories = await sendQuoteTweetChunks(
                                this,
                                response,
                                message.roomId,
                                this.runtime.getSetting("TWITTER_USERNAME"),
                                tweet.tweetId
                            );
                            return memories;
                        } : async (response: Content) => {
                            const memories = await sendTweetChunks(
                                this,
                                response,
                                message.roomId,
                                this.runtime.getSetting("TWITTER_USERNAME"),
                                tweet.tweetId
                            );
                            return memories;
                        };

                        const responseMessages = await callback(responseContent);

                        state = await this.runtime.updateRecentMessageState(state);

                        for (const responseMessage of responseMessages) {
                            await this.runtime.messageManager.createMemory(
                                responseMessage,
                                false
                            );
                        }

                        state = await this.runtime.updateRecentMessageState(state);

                        await this.runtime.evaluate(message, state);

                        await this.runtime.processActions(
                            message,
                            responseMessages,
                            state,
                            callback
                        );

                        const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\nAgent's Output:\n${response.text}`;
                        const debugFileName = `tweetcache/tweet_generation_${selectedTweet.id}.txt`;

                        fs.writeFileSync(debugFileName, responseInfo);
                        await wait();
                    } catch (error) {
                        console.error(`Error sending response post: ${error}`);
                    }
                }
            }

            console.log("Finished checking Twitter interactions");
        } catch (error) {
            console.error("Error handling Twitter interactions:", error);
        }
    }
}