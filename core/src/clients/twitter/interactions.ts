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
    Memory,
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
Aim for 1-2 short sentences maximum. Be concise and direct. only lowercase. rarely use emojis. no hashtags. Your response should not contain any questions. 

Use \\n\\n (double spaces) between statements ONLY IF token data is present.
`+ messageCompletionFooter;

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
Aim for 1-2 short sentences maximum. Be concise and direct. only lowercase. rarely use emojis. no hashtags. Your response should not contain any questions. 

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
    private async handleTweet({
        tweet,
        message,
        action
    }: {
        tweet: Tweet;
        message: Memory;
        action: string;
    }) {

        if (tweet.username === this.runtime.getSetting("TWITTER_USERNAME")) {
            console.log("Skipping tweet from bot itself");
            return;
        }
        if (!message.content.text) {
            return { text: "", action: "IGNORE" };
        }
        console.log("handling tweet", tweet.id);

        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);
        let homeTimeline = [];
        // read the file if it exists
        if (fs.existsSync("tweetcache/home_timeline.json")) {
            homeTimeline = JSON.parse(
                fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
            );
        } else {
            homeTimeline = await this.fetchHomeTimeline(10);
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

        let tokenProviderData: string = ''
        const tiktokProvider = new TikTokProvider(this.runtime)
        const tickerMentions = tweet.text.match(/\$[A-Za-z0-9]+/g) || [];
        const addressMentions = tweet.text.match(/(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})/g) || [];
        const mentions = [...tickerMentions, ...addressMentions];
        if (mentions.length > 0)
            tokenProviderData = await tiktokProvider.getTokenDataByTicker(mentions)

        let state = await this.runtime.composeState(message, {
            twitterClient: this.twitterClient,
            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
            currentPost,
            timeline: formattedHomeTimeline,
        });

        const tweetId = stringToUuid(tweet.id);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            console.log("tweet does not exist, saving");
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(tweet.inReplyToStatusId)
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.saveRequestMessage(message, state);
        }

        console.log("composeState done");

        const context = composeContext({
            state: { ...state, tokenProviderData: tokenProviderData.length == 0 ? tokenProviderData : "No token mention present", exampleData: tokenProviderData.length == 0 ? state.dataExamples : state.randomExamples },
            template: action === "REPLY" ? replyHandlerTemplate : quoteHandlerTemplate,
        });

        const responseContent = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.SMALL,
        });
        responseContent.inReplyTo = action == "REPLY" ? message.id : undefined;
        responseContent.inQuoteTo = action == "QUOTE" ? message.id : undefined;
        if (!responseContent.text) {
            console.log("Returning: No response text found");
            return;
        }

        try {
            const callback: HandlerCallback = action == 'QUOTE' ? async (response: Content) => {
                const memories = await sendQuoteTweetChunks(
                    this,
                    response,
                    message.roomId,
                    this.runtime.getSetting("TWITTER_USERNAME"),
                    tweet.id
                );
                return memories;
            } : async (response: Content) => {
                const memories = await sendTweetChunks(
                    this,
                    response,
                    message.roomId,
                    this.runtime.getSetting("TWITTER_USERNAME"),
                    tweet.id
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

            // const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${responseContent.text}`;
            // const debugFileName = `tweetcache/tweet_generation_${tweet.id}.txt`;

            // fs.writeFileSync(debugFileName, responseInfo);
            await wait();
        } catch (error) {
            console.error(`Error sending response post: ${error}`);
        }
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
- IGNORE: if you feel the comments are spamming a solana address or a ticker. 

Examples for Spam Messages:

Tweet 1 | "EFcCXQyEQ3oMWYxigfP1CpBZpxmZSKY2DLJ5sMrFMDdu"
Tweet 2 | "4BUpsxS9JprqLr7nuBpXBD2aWdAFaeh3dWrZ5GP7pump\n\nYour token"
Tweet 3 | "2m1gxwiUKda89FCcUQkWXB611W2KABEHiMXBVXTopump\n\nHere's your token1"

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
            // const datestr = new Date().toUTCString().replace(/:/g, "-");
            // const logName = `${this.runtime.character.name}_interactions_${datestr}`;
            // log_to_file(logName, prompt);
            let parsedContent: { tweetId: string, action: string }[] = [];
            while (true) {
                console.log("Interaction prompt")
                console.log(prompt)
                const interactionDecisionResponse = await generateText({
                    runtime: this.runtime,
                    context: prompt,
                    modelClass: ModelClass.SMALL,
                });
                console.log("Response from AI for Interaction Operation")
                console.log(interactionDecisionResponse)

                // const responseLogName = `${this.runtime.character.name}_interactions_${datestr}_result`;
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



                if (tweet.action === "IGNORE") continue;
                else if (tweet.action === "LIKE")
                    await likeTweet(this, selectedTweet.id)
                else if (tweet.action === "RETWEET") await retweet(this, selectedTweet.id);
                else if (tweet.action === "REPLY" || tweet.action === "QUOTE") {

                    if (!this.lastCheckedTweetId || parseInt(selectedTweet.id) > this.lastCheckedTweetId) {
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

                        await buildConversationThread(selectedTweet, this);
                        const message = {
                            content: { text: selectedTweet.text },
                            agentId: this.runtime.agentId,
                            userId: userIdUUID,
                            roomId,
                        };

                        await this.handleTweet({
                            tweet: selectedTweet,
                            message,
                            action: tweet.action
                        });

                        this.lastCheckedTweetId = parseInt(selectedTweet.id);

                        try {
                            fs.writeFileSync(
                                this.tweetCacheFilePath,
                                this.lastCheckedTweetId.toString(),
                                "utf-8"
                            );
                        } catch (error) {
                            console.error(
                                "Error saving latest checked tweet ID to file:",
                                error
                            );
                        }

                    }

                    try {
                        fs.writeFileSync(
                            this.tweetCacheFilePath,
                            this.lastCheckedTweetId.toString(),
                            "utf-8"
                        );
                    } catch (error) {
                        console.error(
                            "Error saving latest checked tweet ID to file:",
                            error
                        );
                    }

                    console.log("Finished checking Twitter interactions");
                }
            }

        } catch (error) {
            console.error("Error handling Twitter interactions:", error);
        }
    }
}