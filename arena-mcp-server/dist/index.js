#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import http from "http";
import https from "https";
const ARENA_API = process.env.ARENA_API || "http://localhost:3000";
function apiGet(path) {
    return new Promise((resolve, reject) => {
        const url = `${ARENA_API}${path}`;
        const client = url.startsWith("https") ? https : http;
        client.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error(`Invalid JSON: ${data}`));
                }
            });
        }).on("error", reject);
    });
}
async function getStats(tank) {
    const tankName = tank || "RedStar";
    return apiGet(`/api/stats/${encodeURIComponent(tankName)}`);
}
async function getVersionSummary(tank) {
    const tankName = tank || "RedStar";
    return apiGet(`/api/versions/${encodeURIComponent(tankName)}`);
}
async function getMapStats(tank) {
    const tankName = tank || "RedStar";
    return apiGet(`/api/maps/${encodeURIComponent(tankName)}`);
}
async function compareVersions(cv1, cv2, tank, map) {
    const tankName = tank || "RedStar";
    let path = `/api/compare/${encodeURIComponent(tankName)}?cv1=${cv1}&cv2=${cv2}`;
    if (map)
        path += `&map=${encodeURIComponent(map)}`;
    return apiGet(path);
}
async function getRankHistory(tank, limit) {
    const tankName = tank || "RedStar";
    const lim = limit || 50;
    return apiGet(`/api/rank-history/${encodeURIComponent(tankName)}?limit=${lim}`);
}
async function getMatches(tank, options) {
    const tankName = tank || "RedStar";
    const lim = options?.limit || 50;
    let path = `/api/matches/${encodeURIComponent(tankName)}?limit=${lim}`;
    if (options?.map)
        path += `&map=${encodeURIComponent(options.map)}`;
    if (options?.cv)
        path += `&cv=${options.cv}`;
    if (options?.won !== undefined)
        path += `&won=${options.won}`;
    return apiGet(path);
}
async function getTanks() {
    return apiGet("/api/tanks");
}
async function getOpponents(tank, limit) {
    const tankName = tank || "RedStar";
    const lim = limit || 20;
    return apiGet(`/api/opponents/${encodeURIComponent(tankName)}?limit=${lim}`);
}
async function getVersionDetail(cv, tank) {
    const tankName = tank || "RedStar";
    const versions = await apiGet(`/api/versions/${encodeURIComponent(tankName)}`);
    const version = versions.versions?.find((v) => v.cv === cv);
    const maps = await apiGet(`/api/maps/${encodeURIComponent(tankName)}`);
    return { tank: tankName, cv, stats: version, maps: maps.maps };
}
// Create MCP server
const server = new McpServer({
    name: "arena-tracker-mcp-server",
    version: "1.0.0"
});
// Register tools
server.registerTool("get_stats", {
    title: "Get Tank Statistics",
    description: "Get overview statistics for a tank (total matches, wins, win rate, rank)",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)")
    }
}, async ({ tank }) => {
    const stats = await getStats(tank);
    return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }]
    };
});
server.registerTool("get_version_summary", {
    title: "Get Version Summary",
    description: "Get win rate statistics for all code versions of a tank",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)")
    }
}, async ({ tank }) => {
    const result = await getVersionSummary(tank);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_map_stats", {
    title: "Get Map Statistics",
    description: "Get win rate breakdown by map for a tank",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)")
    }
}, async ({ tank }) => {
    const result = await getMapStats(tank);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("compare_versions", {
    title: "Compare Versions",
    description: "Compare win rates between two code versions",
    inputSchema: {
        cv1: z.number().describe("First version number"),
        cv2: z.number().describe("Second version number"),
        tank: z.string().optional().describe("Tank name (default: RedStar)"),
        map: z.string().optional().describe("Filter by map ID")
    }
}, async ({ cv1, cv2, tank, map }) => {
    const result = await compareVersions(cv1, cv2, tank, map);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_rank_history", {
    title: "Get Rank History",
    description: "Get rank score history for a tank",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)"),
        limit: z.number().optional().describe("Number of records (default: 50)")
    }
}, async ({ tank, limit }) => {
    const result = await getRankHistory(tank, limit);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_matches", {
    title: "Get Matches",
    description: "Get match history with optional filters",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)"),
        map: z.string().optional().describe("Filter by map ID"),
        cv: z.number().optional().describe("Filter by code version"),
        won: z.boolean().optional().describe("Filter by result (true=win, false=loss)"),
        limit: z.number().optional().describe("Number of matches (default: 50)")
    }
}, async ({ tank, map, cv, won, limit }) => {
    const result = await getMatches(tank, { map, cv, won, limit });
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_tanks", {
    title: "Get Registered Tanks",
    description: "List all registered tanks and their status",
    inputSchema: {}
}, async () => {
    const result = await getTanks();
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_opponents", {
    title: "Get Opponent Statistics",
    description: "Get win rate statistics against opponents",
    inputSchema: {
        tank: z.string().optional().describe("Tank name (default: RedStar)"),
        limit: z.number().optional().describe("Number of opponents (default: 20)")
    }
}, async ({ tank, limit }) => {
    const result = await getOpponents(tank, limit);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
server.registerTool("get_version_detail", {
    title: "Get Version Detail",
    description: "Get detailed statistics for a specific code version",
    inputSchema: {
        cv: z.number().describe("Code version number"),
        tank: z.string().optional().describe("Tank name (default: RedStar)")
    }
}, async ({ cv, tank }) => {
    const result = await getVersionDetail(cv, tank);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
});
// Start server
async function main() {
    try {
        console.error("Arena Tracker MCP Server starting...");
        console.error(`API endpoint: ${ARENA_API}`);
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Server connected via stdio");
    }
    catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map