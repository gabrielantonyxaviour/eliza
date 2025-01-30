import { Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import { log_to_file } from "../../core/logger.ts";
import { embeddingZeroVector } from "../../core/memory.ts";
import { IAgentRuntime, ModelClass } from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { generateText } from "../../core/generation.ts";
import { messageCompletionFooter } from "../../core/parsing.ts";

const newTweetPrompt = `{{timeline}}

{{providers}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{postDirections}}

{{recentPosts}}

{{characterPostExamples}}

# Task: Generate a post in the voice and style of {{agentName}}, aka @{{twitterUserName}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. No emojis.`;


const imageTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{recentMessagesByKind}}

{{imageExamples}}

# Instructions: Use the examples as reference and generate a image generation prompt along with an caption for {{agentName}}. Don't use a prompt that is used already. use lowercase only for caption.

\nResponse format should be formatted in a JSON block like this:
\`\`\`json
{ "user": "{{agentName}}", "prompt": string, "caption": string }
\`\`\`
`

const randomTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{recentMessagesByKind}}

{{randomExamples}}

# Instructions: Use the examples as reference and generate a random tweet for {{agentName}}. Don't post a news that is already posted in recent posts. Use lowercase. Rarely use emojis. No hashtags.
` + messageCompletionFooter;

const newsTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{newsProviders}}

{{recentMessagesByKind}}

{{newsExamples}}

# Instructions: Use the examples as reference for tweet format (DO NOT use the Example Posts as source of data. They are just examples.) and choose a news provided by the Top Crypto News or Crypto Twitter which is relevant based on the bio and lore of {{agentName}}. Don't post a news that is already posted in recent posts.  Use lowercase. Rarely use emojis.
` + messageCompletionFooter;


const dataTemplate = `
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{recentMessagesByKind}}

{{newsExamples}}

# Instructions: Use the examples as reference for tweet format (DO NOT use the Example Posts as source of data. They are just examples.) and choose the most trending memecoin provided by the Top Crypto News or Crypto Twitter which is relevant based on the bio and lore of {{agentName}}. Don't post a news that is already posted in recent posts.  Use lowercase. Rarely use emojis. No hashtags.
`

const dataThreadExample = `

`

const newsThreadExample = ``

export class TwitterGenerationClient extends ClientBase {
    onReady() {
        let tweetIndex = 0
        const generateNewTweetLoop = () => {
            let tweetType = 'default';
            if (tweetIndex % 11 == 0) {
                tweetType = 'news';
            } else if (tweetIndex % 6 == 0) {
                tweetType = 'data';
            } else {
                // Probability distribution for other tweet types
                const randomValue = Math.random();
                if (randomValue < 0.64) {
                    tweetType = 'random';
                } else if (randomValue < 0.71) {
                    tweetType = 'image';
                } else if (randomValue < 0.82) {
                    tweetType = 'threads';
                } else if (randomValue < 0.89) {
                    tweetType = 'audio';
                } else {
                    tweetType = 'poll';
                }
            }
            console.log("Seletected tweet type: ", tweetType);
            this.generateNewTweet(tweetType);
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
                    kind: "default",
                },
                {
                    twitterUserName:
                        this.runtime.getSetting("TWITTER_USERNAME"),
                    timeline: formattedHomeTimeline,
                    tweet_kind: "",
                    kind: kind
                }
            );
            // Generate new tweet
            const context = composeContext({
                state,
                template: kind === 'news' ? newsTemplate : kind === 'image' ? imageTemplate : kind === 'random' ? randomTemplate : newTweetPrompt,
            });

            const datestr = new Date().toUTCString().replace(/:/g, "-");

            // log context to file
            log_to_file(
                `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_generate_context`,
                context
            );

            // const promptFilePath = `generate_context_${Date.now()}.txt`;
            // fs.writeFileSync(promptFilePath, context.trim(), "utf8");
            // console.log(`Prompt saved to ${promptFilePath}`);

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // const responseFilePath = `generate_response_${Date.now()}.txt`;
            // fs.writeFileSync(responseFilePath, newTweetContent, "utf8");
            // console.log(`Response saved`);
            console.log("New Tweet:", newTweetContent);
            log_to_file(
                `${this.runtime.getSetting("TWITTER_USERNAME")}_${datestr}_generate_response`,
                JSON.stringify(newTweetContent)
            );

            const slice = newTweetContent.replaceAll(/\\n/g, "\n").trim();

            let content = slice.slice(0, 280);
            // // if its bigger than 280, delete the last line
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
                        async () => await this.twitterClient.sendTweet(content)
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
                            text: newTweetContent.trim(),
                            url: tweet.permanentUrl,
                            source: "twitter",
                        },
                        roomId,
                        embedding: embeddingZeroVector,
                        createdAt: tweet.timestamp * 1000,
                        kind: 'default',
                    });
                } catch (error) {
                    console.error("Error sending tweet:", error);
                }
            } else {
                console.log("Dry run, not sending tweet:", newTweetContent);
            }
        } catch (error) {
            console.error("Error generating new tweet:", error);
        }
    }
}
