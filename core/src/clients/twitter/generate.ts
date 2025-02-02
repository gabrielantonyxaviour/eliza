import { Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import { log_to_file } from "../../core/logger.ts";
import { embeddingZeroVector } from "../../core/memory.ts";
import { IAgentRuntime, Memory, ModelClass } from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { generateMessageResponse, generateText } from "../../core/generation.ts";
import { messageCompletionFooter, parseJSONObjectFromText } from "../../core/parsing.ts";
import { generateImage, storeImage } from "../../actions/imageGenerationUtils.ts";
import { token } from "@coral-xyz/anchor/dist/cjs/utils/index";

export const imageTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

{{recentMessagesByKind}}

{{imageExamples}}

# Instructions: Use the examples as reference and generate a image generation prompt along with an caption for {{agentName}}. Don't use a prompt that is used already. use lowercase only for caption.

\nResponse format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "prompt": string, "caption": string }
\`\`\`
`

export const randomTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{recentMessagesByKind}}

{{randomExamples}}

# Instructions: Use the examples as reference and generate a random tweet for {{agentName}}.  Use lowercase. Rarely use emojis.

You took a long break from tweeting. Now you are back.
` + messageCompletionFooter;

export const newsTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{recentMessagesByKind}}

{{newsExamples}}

# Instructions: Use the examples as reference for tweet format (DO NOT use the Example Posts as source of data. They are just examples.) and choose a news provided by the Top Crypto News or Crypto Twitter which is relevant based on the bio and lore of {{agentName}}. Don't post a news that is already posted in recent posts.  Use lowercase. Rarely use emojis.
` + messageCompletionFooter;

export const dataTemplate = `About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{recentMessagesByKind}}

{{dataExamples}}

Example of expected thread format:

{
  "user": "{{agentName}}",
  "text": [
    "🧵 fresh alpha incoming. market insights you won't find on the charts:",
    "$GEKKO printing heat with 916 tiktok mentions\\n\\n$266k volume on 544 trades today\\n\\n57% buy pressure even with -26% price action",
    "$TIT showing strength\\n\\n239 tiktok mentions and climbing\\n\\n$1.1m market cap with 970m in liquidity\\n\\n11% buy pressure says early",
    "$KLAUS really said watch this\\n\\n222 tiktok mentions\\n\\n$3.1m mcap with 21% buy pressure\\n\\n28 trades say momentum building",
    "$TRUMP absolutely sending it\\n\\n167 tiktok mentions but $127m volume\\n\\n16k trades with 47% buyers\\n\\n$561m locked says serious"
    "stay turned for more! end of thread."
  ],
  "action": ""
}

{
  "user": "{{agentName}}",
  "text": [
    "🧵 memecoin report dropping. let's see what's moving:",
    "$HOOD making power moves\\n\\n167 tiktok degens assembled\\n\\n$127m volume with 16k trades\\n\\n$561m liquidity says we're cooking",
    "$BABY caught momentum\\n\\n916 tiktok mentions no cap\\n\\n544 trades with 57% buyers\\n\\n$371k locked showing strength",
    "$DICK really woke up\\n\\n239 tiktok mentions rising\\n\\n970m base token liquidity\\n\\n$1.1m mcap says opportunity",
    "more gems incoming. stay alert 👀"
  ],
  "action": "end thread"
}

{
  "user": "{{agentName}}",
  "text": [
    "🧵 breaking: market movers you need to watch rn:",
    "$KLAUS heating up fr\\n\\n222 tiktok mentions going parabolic\\n\\n21% buy pressure building\\n\\n$3.1m mcap looking juicy",
    "$AIXBT absolutely ripping\\n\\n16k trades with $127m volume\\n\\n167 tiktok mentions growing\\n\\n47% buyers stepping in",
    "$GRIFFAIN said send it\\n\\n916 tiktok army assembled\\n\\n544 trades in 24h\\n\\n57% buy ratio speaks volumes",
    "thread ends here but alpha never stops 🔥"
  ],
  "action": "end thread"
}

# Instructions: Generate a tweet using the provided real-time market data for the trending tokens and the tweet must includes TikTok mention count. Format the post like the provided examples. If more than two tokens are trending on TikTok, create a Twitter thread. everything in lowercase, tickers only in uppercase. strictly no hashtags.

When creating a thread, the first tweet should be a intro to let people know its a thread followed by the . use this emoji 🧵 to indicate a thread.

\nSingle Tweet Response format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "text": string, "action": string }
\`\`\`

\nThread Tweets format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "text": string[], "action": string }
\`\`\`

`;

export const tokenTemplate = `About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{recentMessagesByKind}}

{{tokenExamples}}

# Instructions: Generate a tweet using the provided real-time market data of the shared tokens. Format the post like the provided examples. everything in lowercase, tickers only in uppercase. strictly no hashtags.

Remember that $ZOROX is your token.

\nSingle Tweet Response format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "text": string, "action": string }
\`\`\`
`

export const pollTemplate = `About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{recentMessagesByKind}}

{{pollExamples}}

# Instructions: Generate a poll about anything related to Crypto, memecoins and TikTok. Format the post like the provided examples. everything in lowercase, tickers only in uppercase. strictly no hashtags.

\nSingle Tweet Response format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "question": string, "options": string[] }
\`\`\``

export const videoTemplate = ``

export class TwitterGenerationClient extends ClientBase {
    onReady() {
        let tweetIndex = 0
        const generateNewTweetLoop = () => {
            let tweetType = 'random';
            if (tweetIndex % 12 == 0) {
                tweetType = 'news';
            } else if (tweetIndex % 6 == 1) {
                tweetType = 'data';
            } else {
                const randomValue = Math.random();
                if (randomValue < 0.75) {
                    tweetType = 'random';
                } else if (randomValue < 0.85) {
                    tweetType = 'image';
                } else {
                    tweetType = 'poll';
                }
                // TODO: Audio 
            }
            console.log("Seletected tweet type: ", tweetType);
            this.generateNewTweet('poll');
            setTimeout(
                generateNewTweetLoop,
                (Math.floor(Math.random() * (90 - 30 + 1)) + 30) * 60 * 1000
            ); // Random interval between 30-90 minutes
        };
        // setTimeout(() => {
        generateNewTweetLoop();
        // }, 5 * 60 * 1000); // Wait 5 minutes before starting the loop
    }

    constructor(runtime: IAgentRuntime) {
        // Initialize the client and pass an optional callback to be called when the client is ready
        super({
            runtime,
        });
    }

    private async generateNewTweet(kind: string = "default") {
        console.log("Generating new tweet");
        try {
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );

            let homeTimeline = [];

            if (!fs.existsSync("tweetcache")) fs.mkdirSync("tweetcache");
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

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid("twitter_generate_room"),
                    agentId: this.runtime.agentId,
                    content: { text: "", action: "" },
                    kind: 'default',
                },
                {
                    twitterUserName:
                        this.runtime.getSetting("TWITTER_USERNAME"),
                    timeline: formattedHomeTimeline,
                    kind
                }
            );

            // Generate new tweet
            const context = composeContext({
                state,
                template: kind === 'news' ? newsTemplate : kind === 'image' ? imageTemplate : kind === 'random' ? randomTemplate : kind == 'data' ? dataTemplate : kind == 'poll' ? pollTemplate : tokenTemplate,
            });

            const datestr = new Date().toUTCString().replace(/:/g, "-");
            if (kind == 'image') {

                const response: any = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });
                const parsedContent = parseJSONObjectFromText(response) as { user: string; prompt: string; caption: string; };
                if (!parsedContent) {
                    console.log("Image prompt: parsedContent is null, retrying");
                    return;
                }

                const images = await generateImage({
                    prompt: parsedContent.prompt,
                    width: 1200,
                    height: 675,
                    count: 1
                }, this.runtime);

                const { url, buffer } = await storeImage(images.data[0], this.runtime.databaseAdapter.getSupabaseClient());
                const imageRes = {
                    image: url,
                    caption: parsedContent.caption
                }

                if (images.data.length == 0) {
                    console.log(
                        "No response from generateMessageResponse"
                    );
                    return;
                }

                if (!this.dryRun) {

                    try {
                        const result = await this.requestQueue.add(
                            async () => await this.twitterClient.sendTweet(imageRes.caption, undefined, [{
                                data: buffer,
                                mediaType: "image/png",
                            }])
                        );
                        // read the body of the response
                        const body = await result.json();
                        console.log("Tweet response:", body);
                        const tweetResult =
                            body.data.create_tweet.tweet_results.result;

                        const tweet = {
                            id: tweetResult.rest_id,
                            text: tweetResult.legacy.full_text,
                            conversationId: tweetResult.legacy.conversation_id_str,
                            createdAt: tweetResult.legacy.created_at,
                            userId: tweetResult.legacy.user_id_str,
                            inReplyToStatusId:
                                tweetResult.legacy.in_reply_to_status_id_str,
                            permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                            hashtags: [],
                            mentions: [],
                            photos: [],
                            thread: [],
                            urls: [],
                            videos: [],
                        } as Tweet;

                        const postId = tweet.id;
                        const conversationId = tweet.conversationId;
                        const roomId = stringToUuid(conversationId);
                        await this.runtime.ensureRoomExists(roomId);
                        await this.runtime.ensureParticipantInRoom(
                            this.runtime.agentId,
                            roomId
                        );

                        await this.cacheTweet(tweet);

                        const memeoryResponse: Memory = {
                            id: stringToUuid(Date.now().toString()),
                            agentId: this.runtime.agentId,
                            roomId,
                            userId: this.runtime.agentId,
                            content: { text: imageRes.caption, image: imageRes.image, },
                            createdAt: Date.now(),
                            kind: "image",
                        }

                        await this.runtime.messageManager.createMemory(memeoryResponse)
                    } catch (e) {

                    }

                }


                return;
            }
            if (kind == 'poll') {
                const response: any = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });
                console.log(response)
                const parsedContent = parseJSONObjectFromText(response) as { user: string; question: string; options: string[]; };
                if (!parsedContent) {
                    console.log("Poll generation: parsedContent is null, retrying");
                    return;
                }


                if (!this.dryRun) {

                    try {
                        const result = await this.twitterClient.sendTweetV2(parsedContent.question, undefined, {
                            poll: {
                                options: [...parsedContent.options.map((option) => {
                                    return {
                                        position: parsedContent.options.indexOf(option),
                                        label: option
                                    }
                                })],
                                duration_minutes: 1440
                            }
                        })
                        // read the body of the response
                        console.log("Tweet response:", result);

                        const tweet = {
                            id: result.id,
                            text: result.text,
                            conversationId: result.conversationId,
                            createdAt: result.timestamp,
                            userId: result.userId,
                            inReplyToStatusId:
                                result.inReplyToStatusId,
                            permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${result.id}`,
                            hashtags: [],
                            mentions: [],
                            photos: [],
                            thread: [],
                            urls: [],
                            videos: [],
                        } as Tweet;

                        const conversationId = tweet.conversationId;
                        const roomId = stringToUuid(conversationId);
                        await this.runtime.ensureRoomExists(roomId);
                        await this.runtime.ensureParticipantInRoom(
                            this.runtime.agentId,
                            roomId
                        );

                        await this.cacheTweet(tweet);

                        const memeoryResponse: Memory = {
                            id: stringToUuid(Date.now().toString()),
                            agentId: this.runtime.agentId,
                            roomId,
                            userId: this.runtime.agentId,
                            content: {
                                text: JSON.stringify({
                                    question: parsedContent.question,
                                    options: parsedContent.options
                                }),
                            },
                            createdAt: Date.now(),
                            kind: "poll",
                        }

                        await this.runtime.messageManager.createMemory(memeoryResponse)
                    } catch (e) {

                    }

                }

                return;
            }



            // log context to file
            // log_to_file(
            //     `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_generate_context`,
            //     context
            // );

            // const promptFilePath = `generate_context_${Date.now()}.txt`;
            // fs.writeFileSync(promptFilePath, context.trim(), "utf8");
            // console.log(`Prompt saved to ${promptFilePath}`);

            const newTweetContent = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });


            // const responseFilePath = `generate_response_${Date.now()}.txt`;
            // fs.writeFileSync(responseFilePath, newTweetContent, "utf8");
            // console.log(`Response saved`);
            console.log("New Tweet:", newTweetContent);
            // log_to_file(
            //     `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_generate_response`,
            //     JSON.stringify(newTweetContent)
            // );

            const slice = Array.isArray(newTweetContent.text)
                ? newTweetContent.text.map((text) => text.replaceAll(/\\n/g, "\n").trim().slice(0, 280))
                : newTweetContent.text.replaceAll(/\\n/g, "\n").trim().slice(0, 280);

            let content = slice

            if (Array.isArray(content)) {
                let lastTweetId = "0";
                for (let newTweet of content) {
                    if (!this.dryRun) {
                        try {
                            const result = await this.requestQueue.add(
                                async () => await this.twitterClient.sendTweet(newTweet, lastTweetId != "0" ? lastTweetId : undefined)
                            );
                            // read the body of the response
                            const body = await result.json();
                            console.log("Tweet response:", body);
                            const tweetResult =
                                body.data.create_tweet.tweet_results.result;

                            const tweet = {
                                id: tweetResult.rest_id,
                                text: tweetResult.legacy.full_text,
                                conversationId: tweetResult.legacy.conversation_id_str,
                                createdAt: tweetResult.legacy.created_at,
                                userId: tweetResult.legacy.user_id_str,
                                inReplyToStatusId:
                                    tweetResult.legacy.in_reply_to_status_id_str,
                                permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                                hashtags: [],
                                mentions: [],
                                photos: [],
                                thread: [],
                                urls: [],
                                videos: [],
                            } as Tweet;

                            const postId = tweet.id;
                            const conversationId = tweet.conversationId;
                            const roomId = stringToUuid(conversationId);
                            lastTweetId = postId;
                            // make sure the agent is in the room
                            await this.runtime.ensureRoomExists(roomId);
                            await this.runtime.ensureParticipantInRoom(
                                this.runtime.agentId,
                                roomId
                            );

                            await this.cacheTweet(tweet);

                            await this.runtime.messageManager.createMemory({
                                id: stringToUuid(postId),
                                userId: this.runtime.agentId,
                                agentId: this.runtime.agentId,
                                content: {
                                    text: newTweet.trim(),
                                    url: tweet.permanentUrl,
                                    source: "twitter",
                                    inReplyTo: lastTweetId ? stringToUuid(lastTweetId.toString()) : undefined
                                },
                                roomId,
                                embedding: embeddingZeroVector,
                                createdAt: tweet.timestamp * 1000,
                                kind
                            });
                        } catch (error) {
                            console.error("Error sending tweet:", error);
                        }
                    } else {
                        console.log("Dry run, not sending tweet:", newTweet);

                    }
                }
            } else {
                if (content.length > 280) {
                    content = content.slice(0, content.lastIndexOf("\n"));
                }

                if (content.length < 1) {
                    content = slice.slice(0, 280);
                }

                // Send the new tweet
                if (!this.dryRun) {

                    try {
                        const result = await this.requestQueue.add(
                            async () => await this.twitterClient.sendTweet(Array.isArray(content) ? content[0] : content)
                        );
                        // read the body of the response
                        const body = await result.json();
                        const tweetResult =
                            body.data.create_tweet.tweet_results.result;

                        const tweet = {
                            id: tweetResult.rest_id,
                            text: tweetResult.legacy.full_text,
                            conversationId: tweetResult.legacy.conversation_id_str,
                            createdAt: tweetResult.legacy.created_at,
                            userId: tweetResult.legacy.user_id_str,
                            inReplyToStatusId:
                                tweetResult.legacy.in_reply_to_status_id_str,
                            permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                            hashtags: [],
                            mentions: [],
                            photos: [],
                            thread: [],
                            urls: [],
                            videos: [],
                        } as Tweet;

                        const postId = tweet.id;
                        const conversationId = tweet.conversationId;
                        const roomId = stringToUuid(conversationId);

                        // make sure the agent is in the room
                        await this.runtime.ensureRoomExists(roomId);
                        await this.runtime.ensureParticipantInRoom(
                            this.runtime.agentId,
                            roomId
                        );

                        await this.cacheTweet(tweet);

                        await this.runtime.messageManager.createMemory({
                            id: stringToUuid(postId),
                            userId: this.runtime.agentId,
                            agentId: this.runtime.agentId,
                            content: {
                                text: (Array.isArray(content) ? content[0] : content).trim(),
                                url: tweet.permanentUrl,
                                source: "twitter",
                            },
                            roomId,
                            embedding: embeddingZeroVector,
                            createdAt: tweet.timestamp * 1000,
                            kind
                        });
                    } catch (error) {
                        console.error("Error sending tweet:", error);
                    }
                } else {
                    console.log("Dry run, not sending tweet:", newTweetContent);
                }
            }
            // // if its bigger than 280, delete the last line

        } catch (error) {
            console.error("Error generating new tweet:", error);
        }
    }
}
