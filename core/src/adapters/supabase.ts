import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
    type Memory,
    type Goal,
    type Relationship,
    Actor,
    GoalStatus,
    Account,
    type UUID,
    Participant,
    Room,
    Mention,
    DeadTicker,
} from "../core/types.ts";
import { DatabaseAdapter } from "../core/database.ts";
import { v4 as uuid } from "uuid";

export class SupabaseDatabaseAdapter extends DatabaseAdapter {

    private supabase: SupabaseClient;

    constructor(supabaseUrl: string, supabaseKey: string) {
        super();
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    getSupabaseClient(): SupabaseClient {
        return this.supabase;
    }

    async getRoom(roomId: UUID): Promise<UUID | null> {
        try {
            const { data, error } = await this.supabase
                .from("rooms")
                .select("id")
                .eq("id", roomId)
                .single();
            console.log("GET ROOM DATA")
            console.log(data)
            if (error) console.log(`Error getting room: ${error.message}`);
            return data ? (data.id as UUID) : null;
        } catch (error) {
            console.error('Error in getRoom:', error);
            throw error;
        }
    }

    async getMemoriesByKind(params: { kind: string; count?: number; agentId: UUID; }): Promise<Memory[]> {
        try {
            const { data, error } = await this.supabase
                .from("memories")
                .select("*")
                .eq("kind", params.kind)
                .eq("agentId", params.agentId)
                .order("createdAt", { ascending: false })
                .limit(params.count ?? 10);

            if (error) throw new Error(`Error getting memories by kind: ${error.message}`);
            return data as Memory[];
        } catch (error) {
            console.error('Error in getMemoriesByKind:', error);
            return [];
        }
    }

    async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
        try {
            const { data, error } = await this.supabase
                .from("participants")
                .select("*")
                .eq("userId", userId);

            if (error) {
                throw new Error(`Error getting participants for account: ${error.message}`);
            }

            return data as Participant[];
        } catch (error) {
            console.error('Error in getParticipantsForAccount:', error);
            return [];
        }
    }
    async getParticipantUserState(
        roomId: UUID,
        userId: UUID
    ): Promise<"FOLLOWED" | "MUTED" | null> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("userState")
            .eq("roomId", roomId)
            .eq("userId", userId)
            .single();

        if (error) {
            console.error("Error getting participant user state:", error);
            return null;
        }

        return data?.userState as "FOLLOWED" | "MUTED" | null;
    }

    async getTrendingMentions(): Promise<Mention[]> {
        try {
            const { data, error } = await this.supabase
                .rpc('get_trending_mentions');

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting trending mentions:', error);
            throw error;
        }
    }

    async getMentionsByTicker(ticker: string): Promise<number> {
        try {
            const { data, error } = await this.supabase
                .rpc('get_mentions_by_ticker', {
                    ticker
                });

            if (error) throw error;
            return data.total_count;
        } catch (error) {
            console.error('Error getting trending mentions:', error);
            throw error;
        }
    }

    async getAggregatedMentions(): Promise<Mention[]> {
        try {
            const { data, error } = await this.supabase
                .rpc('get_aggregated_mentions');

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting aggregated mentions:', error);
            throw error;
        }
    }

    async updateDeadTickers(tickerData: DeadTicker[]): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('tickers')
                .upsert(tickerData).select()

            if (error) {
                console.error('Error upserting data into Supabase:', error);
            } else {
                console.log('Data successfully upserted into Supabase');
            }
        } catch (error) {
            console.error('Error upserting dead mentions:', error);
            throw error;
        }
    }

    async setParticipantUserState(
        roomId: UUID,
        userId: UUID,
        state: "FOLLOWED" | "MUTED" | null
    ): Promise<void> {
        const { error } = await this.supabase
            .from("participants")
            .update({ userState: state })
            .eq("roomId", roomId)
            .eq("userId", userId);

        if (error) {
            console.error("Error setting participant user state:", error);
            throw new Error("Failed to set participant user state");
        }
    }

    async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("userId")
            .eq("roomId", roomId);

        if (error) {
            throw new Error(
                `Error getting participants for room: ${error.message}`
            );
        }

        return data.map((row) => row.userId as UUID);
    }

    x
    async getMemoriesByRoomIds(params: {
        roomIds: UUID[];
        agentId?: UUID;
    }): Promise<Memory[]> {
        let query = this.supabase
            .from("memories")
            .select("*")
            .in("roomId", params.roomIds);

        if (params.agentId) {
            query = query.eq("agentId", params.agentId);
        }

        const { data, error } = await query;

        if (error) {
            console.error("Error retrieving memories by room IDs:", error);
            return [];
        }

        // map createdAt to Date
        const memories = data.map((memory) => ({
            ...memory,
        }));

        return memories as Memory[];
    }

    async getAccountById(userId: UUID): Promise<Account | null> {
        const { data, error } = await this.supabase
            .from("accounts")
            .select("*")
            .eq("id", userId);
        if (error) {
            throw new Error(error.message);
        }
        return (data?.[0] as Account) || null;
    }

    async createAccount(account: Account): Promise<boolean> {
        const { error } = await this.supabase
            .from("accounts")
            .upsert([account]);
        if (error) {
            console.error(error.message);
            return false;
        }
        return true;
    }

    async getActorDetails(params: { roomId: UUID }): Promise<Actor[]> {
        try {
            const response = await this.supabase
                .from("rooms")
                .select(
                    `
          participants:participants(
            account:accounts(id, name, username, details)
          )
      `
                )
                .eq("id", params.roomId);

            if (response.error) {
                console.error("Error!" + response.error);
                return [];
            }
            const { data } = response;

            return data
                .map((room) =>
                    room.participants.map((participant) => {
                        const user = participant.account as unknown as Actor;
                        return {
                            name: user?.name,
                            details: user?.details,
                            id: user?.id,
                            username: user?.username,
                        };
                    })
                )
                .flat();
        } catch (error) {
            console.error("error", error);
            throw error;
        }
    }

    async searchMemories(params: {
        tableName: string;
        roomId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        is_unique: boolean;
    }): Promise<Memory[]> {
        const result = await this.supabase.rpc("search_memories", {
            query_table_name: params.tableName,
            query_roomId: params.roomId,
            query_embedding: params.embedding,
            query_match_threshold: params.match_threshold,
            query_match_count: params.match_count,
            query_unique: params.is_unique,
        });
        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
        return result.data.map((memory) => ({
            ...memory,
        }));
    }

    async getCachedEmbeddings(opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<
        {
            embedding: number[];
            levenshtein_score: number;
        }[]
    > {
        const result = await this.supabase.rpc("get_embedding_list", opts);
        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
        return result.data;
    }

    async updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void> {
        await this.supabase
            .from("goals")
            .update({ status: params.status })
            .match({ id: params.goalId });
    }

    async log(params: {
        body: { [key: string]: unknown };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void> {
        const { error } = await this.supabase.from("logs").insert({
            body: params.body,
            userId: params.userId,
            roomId: params.roomId,
            type: params.type,
        });

        if (error) {
            console.error("Error inserting log:", error);
            throw new Error(error.message);
        }
    }
    async getMemoriesByUserId(params: {
        userId: UUID;
        count?: number;
        is_unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        try {
            const query = this.supabase
                .from(params.tableName)
                .select("*")
                .eq("userId", params.userId);

            if (params.start) {
                query.gte("createdAt", params.start);
            }

            if (params.end) {
                query.lte("createdAt", params.end);
            }

            if (params.is_unique) {
                query.eq("unique", true);
            }

            if (params.agentId) {
                query.eq("agentId", params.agentId);
            }

            query.order("createdAt", { ascending: false });

            if (params.count) {
                query.limit(params.count);
            }

            const { data, error } = await query;

            if (error) {
                throw new Error(`Error retrieving memories: ${error.message}`);
            }

            return data as Memory[];
        } catch (error) {
            console.error('Error in getMemoriesByUserId:', error);
            return [];
        }
    }


    async getMemories(params: {
        roomId: UUID;
        count?: number;
        is_unique?: boolean;
        tableName: string;
        agentId?: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        const query = this.supabase
            .from("memories")
            .select("*")
            .eq("roomId", params.roomId)
            .eq("type", params.tableName);

        if (params.start) {
            query.gte("createdAt", new Date(params.start).toISOString());
        }

        if (params.end) {
            query.lte("createdAt", new Date(params.end).toISOString());
        }

        if (params.is_unique) {
            query.eq("is_unique", 1);
        }

        if (params.agentId) {
            query.eq("agentId", params.agentId);
        }

        query.order("createdAt", { ascending: false });

        if (params.count) {
            query.limit(params.count);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Error retrieving memories: ${error.message}`);
        }

        return data as Memory[];
    }

    async getMemoryById(memoryId: UUID): Promise<Memory | null> {
        console.log(memoryId)
        const { data, error } = await this.supabase
            .from("memories")
            .select("*")
            .eq("id", memoryId)
            .single();

        if (error) {
            console.error("Error retrieving memory by ID:", error);
            return null;
        }

        return data as Memory;
    }

    async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            roomId?: UUID;
            agentId?: UUID;
            is_unique?: boolean;
            tableName: string;
        }
    ): Promise<Memory[]> {
        try {
            const queryParams = {
                query_table_name: params.tableName,
                query_roomId: params.roomId,
                query_embedding: embedding,
                query_match_threshold: params.match_threshold ?? 0.8, // Default threshold
                query_match_count: params.count ?? 10, // Default count
                query_unique: params.is_unique ?? 0,
                ...(params.agentId && { query_agentId: params.agentId })
            };

            const { data, error } = await this.supabase.rpc("search_memories", queryParams);

            if (error) throw new Error(JSON.stringify(error));

            return (data ?? []).map((memory) => ({
                ...memory,
                createdAt: memory.createdAt ? new Date(memory.createdAt) : new Date(),
            }));
        } catch (error) {
            console.error('Error in searchMemoriesByEmbedding:', error);
            return [];
        }
    }

    async createMemory(
        memory: Memory,
        tableName: string,
        unique = false
    ): Promise<void> {
        try {
            const createdAt = memory.createdAt ? new Date(memory.createdAt).toISOString() : new Date().toISOString();
            console.log({ ...memory, createdAt, type: tableName });
            if (unique) {
                const opts = {
                    query_table_name: tableName,
                    query_userId: memory.userId,
                    query_content: memory.content.text,
                    query_roomId: memory.roomId,
                    query_embedding: memory.embedding,
                    query_createdAt: createdAt,
                    query_kind: memory.kind ?? "default",
                    similarity_threshold: 0.95,
                };

                const { error } = await this.supabase.rpc(
                    "check_similarity_and_insert",
                    opts
                );

                if (error) throw new Error(JSON.stringify(error));
            } else {
                const { error } = await this.supabase
                    .from("memories")
                    .insert({ ...memory, createdAt, type: tableName });

                if (error) throw new Error(JSON.stringify(error));
            }
        } catch (error) {
            console.error('Error in createMemory:', error);
            throw error;
        }
    }
    async removeMemory(memoryId: UUID): Promise<void> {
        const result = await this.supabase
            .from("memories")
            .delete()
            .eq("id", memoryId);
        const { error } = result;
        if (error) {
            throw new Error(JSON.stringify(error));
        }
    }

    async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
        const result = await this.supabase.rpc("remove_memories", {
            query_table_name: tableName,
            query_roomId: roomId,
        });

        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }
    }

    async countMemories(
        roomId: UUID,
        is_unique = true,
        tableName: string
    ): Promise<number> {
        if (!tableName) {
            throw new Error("tableName is required");
        }
        const query = {
            query_table_name: tableName,
            query_roomId: roomId,
            query_unique: is_unique ? 1 : 0,
        };
        const result = await this.supabase.rpc("count_memories", query);

        if (result.error) {
            throw new Error(JSON.stringify(result.error));
        }

        return result.data;
    }

    async getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {

        console.log({
            only_in_progress: params.onlyInProgress,
            query_roomid: params.roomId as string,
            query_userId: params.userId ? params.userId as string : null,
            row_count: params.count,
        })
        const { data: goals, error } = await this.supabase.rpc(
            "get_goals",
            {
                only_in_progress: params.onlyInProgress,
                query_roomid: params.roomId as string,
                query_userid: params.userId ? params.userId as string : null,
                row_count: params.count,
            }
        );

        if (error) {
            throw new Error(error.message);
        }

        return goals;
    }

    async updateGoal(goal: Goal): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .update(goal)
            .match({ id: goal.id });
        if (error) {
            throw new Error(`Error creating goal: ${error.message}`);
        }
    }

    async createGoal(goal: Goal): Promise<void> {
        const { error } = await this.supabase.from("goals").insert(goal);
        if (error) {
            throw new Error(`Error creating goal: ${error.message}`);
        }
    }

    async removeGoal(goalId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .delete()
            .eq("id", goalId);
        if (error) {
            throw new Error(`Error removing goal: ${error.message}`);
        }
    }

    async removeAllGoals(roomId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("goals")
            .delete()
            .eq("roomId", roomId);
        if (error) {
            throw new Error(`Error removing goals: ${error.message}`);
        }
    }

    async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("roomId")
            .eq("userId", userId);

        if (error) {
            throw new Error(
                `Error getting rooms by participant: ${error.message}`
            );
        }

        return data.map((row) => row.roomId as UUID);
    }

    async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
        const { data, error } = await this.supabase
            .from("participants")
            .select("roomId")
            .in("userId", userIds);

        if (error) {
            throw new Error(
                `Error getting rooms by participants: ${error.message}`
            );
        }

        return [...new Set(data.map((row) => row.roomId as UUID))] as UUID[];
    }

    async createRoom(roomId?: UUID): Promise<UUID> {
        roomId = roomId ?? (uuid() as UUID);
        const { data, error } = await this.supabase.from("rooms").insert({
            id: roomId,
            createdAt: new Date().toISOString(),
        }).select();

        if (error) {
            throw new Error(`Error creating room: ${error.message}`);
        }

        if (!data || data.length === 0) {
            throw new Error("No data returned from room creation");
        }

        return data[0].id as UUID;
    }

    async removeRoom(roomId: UUID): Promise<void> {
        const { error } = await this.supabase
            .from("rooms")
            .delete()
            .eq("id", roomId);

        if (error) {
            throw new Error(`Error removing room: ${error.message}`);
        }
    }

    async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        const { error } = await this.supabase
            .from("participants")
            .insert({ userId: userId, roomId: roomId });

        if (error) {
            console.error(`Error adding participant: ${error.message}`);
            return false;
        }
        return true;
    }

    async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        const { error } = await this.supabase
            .from("participants")
            .delete()
            .eq("userId", userId)
            .eq("roomId", roomId);

        if (error) {
            console.error(`Error removing participant: ${error.message}`);
            return false;
        }
        return true;
    }

    async createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean> {
        try {
            const allRoomData = await this.getRoomsForParticipants([
                params.userA,
                params.userB,
            ]);

            let roomId: UUID;

            if (!allRoomData?.length) {
                const { data: newRoomData, error: roomsError } = await this.supabase
                    .from("rooms")
                    .insert({})
                    .select()
                    .single();

                if (roomsError) throw new Error("Room creation error: " + roomsError.message);
                if (!newRoomData) throw new Error("No room data returned after creation");

                roomId = newRoomData.id as UUID;
            } else {
                roomId = allRoomData[0];
            }

            await this.supabase.from("participants").insert([
                { userId: params.userA, roomId },
                { userId: params.userB, roomId },
            ]);

            const { error: relationshipError } = await this.supabase
                .from("relationships")
                .upsert({
                    userA: params.userA,
                    userB: params.userB,
                    userId: params.userA,
                    status: "FRIENDS",
                });

            if (relationshipError) {
                throw new Error("Relationship creation error: " + relationshipError.message);
            }

            return true;
        } catch (error) {
            console.error('Error in createRelationship:', error);
            throw error;
        }
    }


    async getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null> {
        const { data, error } = await this.supabase.rpc("get_relationship", {
            usera: params.userA,
            userb: params.userB,
        });

        if (error) {
            throw new Error(error.message);
        }

        return data[0];
    }

    async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
        const { data, error } = await this.supabase
            .from("relationships")
            .select("*")
            .or(`userA.eq.${params.userId},userB.eq.${params.userId}`)
            .eq("status", "FRIENDS");

        if (error) {
            throw new Error(error.message);
        }

        return data as Relationship[];
    }
}
