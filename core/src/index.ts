// Exports
export * from "./actions/index.ts";
export * from "./clients/index.ts";
export * from "./adapters/index.ts";
export * from "./providers/index.ts";

import * as Client from "./clients/index.ts";

import { Character } from "./core/types.ts";

import readline from "readline";
import { Arguments } from "./types/index.ts";
import {
    createAgentRuntime,
    createDirectRuntime,
    getTokenForProvider,
    initializeClients,
    initializeDatabase,
    initializeSupabase,
    loadCharacters,
    parseArguments,
} from "./cli/index.ts";
import { PrettyConsole } from "./cli/colors.ts";
import { stringToUuid } from "./core/uuid.ts";

let argv: Arguments = parseArguments();

const characters = loadCharacters(argv.characters);

const directClient = new Client.DirectClient();

// Initialize the pretty console
export const prettyConsole = new PrettyConsole();
prettyConsole.clear();
prettyConsole.closeByNewLine = true;
prettyConsole.useIcons = true;

// Start the direct client
const serverPort = parseInt(process.env.SERVER_PORT || "3000");
directClient.start(serverPort);

async function startAgent(character: Character) {
    prettyConsole.success(`Starting agent for character ${character.name}`);
    const token = getTokenForProvider(character.modelProvider, character);
    // const db = initializeDatabase();
    const db = initializeSupabase()

    const runtime = await createAgentRuntime(
        character,
        db,
        token,
        "agentConfig.yaml"
    );
    const directRuntime = await createDirectRuntime(
        character,
        db,
        token,
        "agentConfig.yaml"
    );

    const clients = await initializeClients(character, runtime);
    directClient.registerAgent(directRuntime);

    return clients;
}

const startAgents = async () => {
    for (const character of characters) {
        await startAgent(character);
    }
};

startAgents();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function chat() {
    rl.question("You: ", async (input) => {
        if (input.toLowerCase() === "exit") {
            rl.close();
            return;
        }

        const agentId = (characters[0].id ? characters[0].id.toLowerCase() : stringToUuid(characters[0].name));
        const response = await fetch(
            `http://localhost:3000/${agentId}/message`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text: input,
                    userId: "user",
                    userName: "User",
                }),
            }
        );

        const data = await response.json();
        console.log(`${characters[0].name}: ${data.text}`);
        chat();
    });
}

console.log("Chat started. Type 'exit' to quit.");
chat();
