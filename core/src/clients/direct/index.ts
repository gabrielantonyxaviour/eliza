import bodyParser from "body-parser";
import express from "express";
import { composeContext } from "../../core/context.ts";
import { AgentRuntime } from "../../core/runtime.ts";
import { Content, Memory, ModelClass, State } from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import cors from "cors";
import { messageCompletionFooter } from "../../core/parsing.ts";
import multer, { File } from "multer";
import { Request as ExpressRequest } from "express";
import { generateMessageResponse } from "../../core/generation.ts";
import {
    generateCaption,
    generateImage,
    storeImage,
} from "../../actions/imageGenerationUtils.ts";

const upload = multer({ storage: multer.memoryStorage() });

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

# Instructions: Use the examples as reference and generate a random tweet for {{agentName}}. Don't post a news that is already posted in recent posts. Use lowercase. Rarely use emojis.
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

Tweet 1: "🧵 breaking down today's hottest tokens.\n\nhere's what your charts won't show you:"
Tweet 2: "$TRUMP really showing up today\n\n2.1m volume with 53% buy pressure\n\n24h trades at 459 and climbing\n\n47 tiktok mentions say gm"
Tweet 3: "$WIF making moves\n\n1.8m liquidity locked + 65k trades today\n\n14% price surge in 24h\n\n53 tiktok army growing"
Tweet 4: "$TIT actually printed $12m volume\n\n65k trades in 24h is no joke\n\n14% price surge while you slept\n\n9.8k tiktok army assembled"
Last Tweet: "👀 more alpha dropping soon. end of thread."

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


export interface SimliClientConfig {
    apiKey: string;
    faceID: string;
    handleSilence: boolean;
    videoRef: any;
    audioRef: any;
}
class DirectClient {
    private app: express.Application;
    private agents: Map<string, AgentRuntime>;

    constructor() {
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));

        // Define an interface that extends the Express Request interface
        interface CustomRequest extends ExpressRequest {
            file: File;
        }

        // Update the route handler to use CustomRequest instead of express.Request
        this.app.post(
            "/:agentId/whisper",
            upload.single("file"),
            async (req: CustomRequest, res: express.Response) => {
                const audioFile = req.file; // Access the uploaded file using req.file
                const agentId = req.params.agentId;

                if (!audioFile) {
                    res.status(400).send("No audio file provided");
                    return;
                }

                let runtime = this.agents.get(agentId);

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).send("Agent not found");
                    return;
                }

                const formData = new FormData();
                const audioBlob = new Blob([audioFile.buffer], {
                    type: audioFile.mimetype,
                });
                formData.append("file", audioBlob, audioFile.originalname);
                formData.append("model", "whisper-1");

                const response = await fetch(
                    "https://api.openai.com/v1/audio/transcriptions",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${runtime.token}`,
                        },
                        body: formData,
                    }
                );

                const data = await response.json();
                res.json(data);
            }
        );

        this.app.post(
            "/:agentId/message",
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const agent = this.agents.get(agentId);
                console.log(agentId)
                if (!agent) {
                    res.status(404).send("Agent not found");
                    return;
                }
                const roomId = stringToUuid(
                    req.body.roomId ?? "default-room-" + agentId
                );
                const userId = stringToUuid(req.body.userId ?? "user");

                let runtime = this.agents.get(agentId);

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).send("Agent not found");
                    return;
                }

                await runtime.ensureConnection(
                    userId,
                    roomId,
                    req.body.userName,
                    req.body.name,
                    "direct"
                );

                const text = req.body.text;
                const messageId = stringToUuid(Date.now().toString());

                const content: Content = {
                    text,
                    attachments: [],
                    source: "direct",
                    inReplyTo: undefined,
                };

                const userMessage = {
                    content,
                    userId,
                    roomId,
                    agentId: runtime.agentId,
                };

                const memory: Memory = {
                    id: messageId,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                await runtime.messageManager.createMemory(memory);

                const state = (await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                    kind: text,
                })) as State;

                let context;
                if (text == 'random') context = composeContext({
                    state, template: randomTemplate
                });
                else if (text == 'news')
                    context = composeContext({
                        state,
                        template: newsTemplate,
                    });
                else if (text == 'image') {
                    context = composeContext({
                        state,
                        template: imageTemplate,
                    });

                    const response: any = await generateMessageResponse({
                        runtime: runtime,
                        context,
                        modelClass: ModelClass.SMALL,
                    });

                    const images = await generateImage({
                        prompt: response.prompt,
                        width: 1200,
                        height: 675,
                        count: 1
                    }, runtime);

                    const imageUrl = await storeImage(images.data[0], agent.databaseAdapter.getSupabaseClient());
                    const imageRes = {
                        image: imageUrl,
                        caption: response.caption
                    }

                    if (images.data.length == 0) {
                        res.status(500).send(
                            "No response from generateMessageResponse"
                        );
                        return;
                    }

                    const memeoryResponse: Memory = {
                        id: stringToUuid(Date.now().toString()),
                        agentId: runtime.agentId,
                        roomId: roomId,
                        userId: runtime.agentId,
                        content: { text: imageRes.caption, image: imageRes.image, },
                        createdAt: Date.now(),
                        kind: "image",
                    }

                    await runtime.messageManager.createMemory(memeoryResponse)

                    res.json({ images: imageRes });
                    return;
                }

                else if (text == 'data') context = composeContext({
                    state, template: dataTemplate
                });
                else context = composeContext({
                    state,
                    template: randomTemplate,
                });
                console.log(context)
                const response = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.LARGE,
                });

                // save response to memory
                const responseMessage = {
                    id: stringToUuid(Date.now().toString()),
                    agentId: runtime.agentId,
                    roomId: roomId,
                    userId: runtime.agentId,
                    content: response,
                    createdAt: Date.now(),
                };

                await runtime.messageManager.createMemory(responseMessage);

                if (!response) {
                    res.status(500).send(
                        "No response from generateMessageResponse"
                    );
                    return;
                }

                res.json(response);
            }
        );

        this.app.post(
            "/:agentId/image",
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const agent = this.agents.get(agentId);
                if (!agent) {
                    res.status(404).send("Agent not found");
                    return;
                }

                const images = await generateImage({ ...req.body }, agent);
                const imagesRes: { image: string; caption: string }[] = [];
                if (images.data && images.data.length > 0) {
                    for (let i = 0; i < images.data.length; i++) {
                        const caption = await generateCaption(
                            { imageUrl: images.data[i] },
                            agent
                        );
                        imagesRes.push({
                            image: images.data[i],
                            caption: caption.title,
                        });
                    }
                }
                res.json({ images: imagesRes });
            }
        );
    }

    public registerAgent(runtime: AgentRuntime) {
        this.agents.set(runtime.agentId, runtime);
    }

    public unregisterAgent(runtime: AgentRuntime) {
        this.agents.delete(runtime.agentId);
    }

    public start(port: number) {
        this.app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}/`);
        });
    }
}

export { DirectClient };
