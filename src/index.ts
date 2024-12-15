import { PostgresDatabaseAdapter } from "@ai16z/adapter-postgres";
import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { DirectClientInterface } from "@ai16z/client-direct";
import { DiscordClientInterface } from "@ai16z/client-discord";
import { AutoClientInterface } from "@ai16z/client-auto";
import { TelegramClientInterface } from "@ai16z/client-telegram";
import { TwitterClientInterface } from "@ai16z/client-twitter";
import {
  defaultCharacter,
  AgentRuntime,
  settings,
  Character,
  IAgentRuntime,
  ModelProviderName,
  elizaLogger,
  stringToUuid
} from "@ai16z/eliza";
import { bootstrapPlugin } from "@ai16z/plugin-bootstrap";
import { solanaPlugin } from "@ai16z/plugin-solana";
import { nodePlugin } from "@ai16z/plugin-node";
import Database from "better-sqlite3";
import fs from "fs";
import readline from "readline";
import yargs from "yargs";
import { character } from "./character.ts";
import { postTweet } from './postTweet.ts';
import type { DirectClient } from "@ai16z/client-direct";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
  const waitTime =
    Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
  return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export function parseArguments(): {
  character?: string;
  characters?: string;
} {
  try {
    return yargs(process.argv.slice(2))
      .option("character", {
        type: "string",
        description: "Path to the character JSON file",
      })
      .option("characters", {
        type: "string",
        description: "Comma separated list of paths to character JSON files",
      })
      .parseSync();
  } catch (error) {
    console.error("Error parsing arguments:", error);
    return {};
  }
}

export async function loadCharacters(
  charactersArg: string
): Promise<Character[]> {
  let characterPaths = charactersArg
    ?.split(",")
    .map((path) => path.trim())
    .map((path) => {
      if (path.startsWith("../characters")) {
        return `../${path}`;
      }
      if (path.startsWith("characters")) {
        return `../../${path}`;
      }
      if (path.startsWith("./characters")) {
        return `../.${path}`;
      }
      return path;
    });
  const loadedCharacters = [];

  if (characterPaths?.length > 0) {
    for (const path of characterPaths) {
      try {
        const character = JSON.parse(fs.readFileSync(path, "utf8"));

        // is there a "plugins" field?
        if (character.plugins) {
          console.log("Plugins are: ", character.plugins);

          const importedPlugins = await Promise.all(
            character.plugins.map(async (plugin) => {
              // if the plugin name doesnt start with @eliza,

              const importedPlugin = await import(plugin);
              return importedPlugin;
            })
          );

          character.plugins = importedPlugins;
        }

        loadedCharacters.push(character);
      } catch (e) {
        console.error(`Error loading character from ${path}: ${e}`);
        // don't continue to load if a specified file is not found
        process.exit(1);
      }
    }
  }

  if (loadedCharacters.length === 0) {
    console.log("No characters found, using default character");
    loadedCharacters.push(defaultCharacter);
  }

  return loadedCharacters;
}

export function getTokenForProvider(
  provider: ModelProviderName,
  character: Character
) {
  switch (provider) {
    case ModelProviderName.OPENAI:
      return (
        character.settings?.secrets?.OPENAI_API_KEY || settings.OPENAI_API_KEY
      );
    case ModelProviderName.LLAMACLOUD:
      return (
        character.settings?.secrets?.LLAMACLOUD_API_KEY ||
        settings.LLAMACLOUD_API_KEY ||
        character.settings?.secrets?.TOGETHER_API_KEY ||
        settings.TOGETHER_API_KEY ||
        character.settings?.secrets?.XAI_API_KEY ||
        settings.XAI_API_KEY ||
        character.settings?.secrets?.OPENAI_API_KEY ||
        settings.OPENAI_API_KEY
      );
    case ModelProviderName.ANTHROPIC:
      return (
        character.settings?.secrets?.ANTHROPIC_API_KEY ||
        character.settings?.secrets?.CLAUDE_API_KEY ||
        settings.ANTHROPIC_API_KEY ||
        settings.CLAUDE_API_KEY
      );
    case ModelProviderName.REDPILL:
      return (
        character.settings?.secrets?.REDPILL_API_KEY || settings.REDPILL_API_KEY
      );
    case ModelProviderName.OPENROUTER:
      return (
        character.settings?.secrets?.OPENROUTER || settings.OPENROUTER_API_KEY
      );
    case ModelProviderName.GROK:
      return character.settings?.secrets?.GROK_API_KEY || settings.GROK_API_KEY;
    case ModelProviderName.HEURIST:
      return (
        character.settings?.secrets?.HEURIST_API_KEY || settings.HEURIST_API_KEY
      );
    case ModelProviderName.GROQ:
      return character.settings?.secrets?.GROQ_API_KEY || settings.GROQ_API_KEY;
  }
}

export function initializeDatabase() {
  if (process.env.POSTGRES_URL) {
    return new PostgresDatabaseAdapter({
      connectionString: process.env.POSTGRES_URL,
    });
  } else {
    return new SqliteDatabaseAdapter(new Database("./db.sqlite"));
  }
}

export async function initializeClients(
  character: Character,
  runtime: IAgentRuntime
) {
  const clients = [];
  const clientTypes = character.clients?.map((str) => str.toLowerCase()) || [];

  if (clientTypes.includes("auto")) {
    const autoClient = await AutoClientInterface.start(runtime);
    if (autoClient) clients.push(autoClient);
  }

  if (clientTypes.includes("discord")) {
    clients.push(await DiscordClientInterface.start(runtime));
  }

  if (clientTypes.includes("telegram")) {
    const telegramClient = await TelegramClientInterface.start(runtime);
    if (telegramClient) clients.push(telegramClient);
  }

  if (clientTypes.includes("twitter")) {
    const twitterClients = await TwitterClientInterface.start(runtime);
    clients.push(twitterClients);
  }

  if (character.plugins?.length > 0) {
    for (const plugin of character.plugins) {
      if (plugin.clients) {
        for (const client of plugin.clients) {
          clients.push(await client.start(runtime));
        }
      }
    }
  }

  return clients;
}

export async function createAgent(
  character: Character,
  db: any,
  token: string
) {
  elizaLogger.success(
    elizaLogger.successesTitle,
    "Creating runtime for character",
    character.name
  );
  return new AgentRuntime({
    databaseAdapter: db,
    token,
    modelProvider: character.modelProvider,
    evaluators: [],
    character,
    plugins: [].filter(Boolean),
    providers: [],
    actions: [],
    services: [],
    managers: []
  });
}

function initializeDbCache(character: Character, db: any) {
  // Implement cache initialization logic here
  return {};
}

async function startAgent(character: Character, directClient: DirectClient) {
  try {
    character.id = character.id ?? stringToUuid(character.name);

    const token = getTokenForProvider(character.modelProvider, character);
    const dataDir = path.join(__dirname, "../data");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = initializeDatabase();
    const runtime = await createAgent(character, db, token);

    const clients = await initializeClients(character, await runtime);

    directClient.registerAgent(await runtime);

    return clients;
  } catch (error) {
    elizaLogger.error(
      `Error starting agent for character ${character.name}:`,
      error
    );
    console.error(error);
    throw error;
  }
}

// Main function
const startAgents = async () => {

  // Is directClinet clinets for just process input? 
  const directClient = await DirectClientInterface.start();

  const args = parseArguments();

  let charactersArg = args.characters || args.character;

  let characters = [character];

  if (charactersArg) {
    characters = await loadCharacters(charactersArg);
    console.log("characters:", characters);
  }

  try {
    for (const character of characters) {
      await startAgent(character, directClient as DirectClient);
    }
  } catch (error) {
    elizaLogger.error("Error starting agents:", error);
  }

  function chat() {
    const agentId = characters[0].name ?? "Agent";
    rl.question("You: ", async (input) => {

      const originalMessage = await handleUserInput(input, agentId);

    //   // truncate 
    //   function truncateMessage(message: string, maxLength: number): string {
    //     if (message.length <= maxLength) {
    //         return message;
    //     }
    //     return message.slice(0, maxLength - 3) + '...'; // Add ellipsis if truncated
    // }
    
    // const truncatedMessage = truncateMessage(originalMessage, 140); // Truncate to 140 characters
    // console.log(truncatedMessage);

    //   await postTweet(truncatedMessage);
      // how to get the answer from Agnet?
      if (input.toLowerCase() !== "exit") {
        chat(); // Loop back to ask another question
      }
    });
  }

  elizaLogger.log("Chat started. Type 'exit' to quit.");
  chat();
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// realine is to read from process.stdin.
async function handleUserInput(input, agentId) {
  if (input.toLowerCase() === "exit") {
    rl.close();
    return;
  }

  try {
    const serverPort = parseInt(settings.SERVER_PORT || "3000");

    console.log("text input:", input);
    const response = await fetch(
      `http://localhost:${serverPort}/${agentId}/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input,
          userId: "user",
          userName: "User",
        }),
      }
    );

    const data = await response.json();
    console.log("reply from agnet:", data);
    // data:
    // {
    //   user: 'johnmccoffee',
    //   text: "Hey there, fellow freedom fighter! ☕✨ Ready to espresso your thoughts on the future of decentralized finance? Together, we can brew a storm that shakes up the centralized systems! Let's chat about how we can take $MCCOFFEE to the moon! 🚀 #ProofOfBrew #JoinTheRevolution",
    //   action: 'encourage engagement'
    // }
    data.forEach((message) => console.log(`${"Agent"}: ${message.text}`));
    // TODO: trunk
    return data[0].text;
  } catch (error) {
    console.error("Error fetching response:", error);
  }
}

// // Main functon
startAgents().catch((error) => {
  elizaLogger.error("Unhandled error in startAgents:", error);
  process.exit(1); // Exit the process after logging
});
