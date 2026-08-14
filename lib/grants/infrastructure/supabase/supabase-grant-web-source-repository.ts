import { z } from "zod";
import { GrantWebSearchSessionSchema, GrantWebSourceSnapshotSchema } from "../../web-sources/contracts.ts";
import type { GrantWebSourceRepository } from "../../ports/grant-web-source-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";
const check=(name:string,error:{message:string}|null)=>{if(error)throw new Error(`${name} failed: ${error.message}`);};
export class SupabaseGrantWebSourceRepository implements GrantWebSourceRepository {
  private readonly client: GrantSupabaseRpcClient; private readonly ownerId:string;
  constructor(client:GrantSupabaseRpcClient,ownerId:string){this.client=client;this.ownerId=ownerId;}
  async createSearchSession(session:Parameters<GrantWebSourceRepository["createSearchSession"]>[0]){const{error}=await this.client.rpc("create_grant_web_search_session",{p_owner_id:this.ownerId,p_session:session});check("create_grant_web_search_session",error);}
  async getSearchSession(searchSessionId:string){const{data,error}=await this.client.rpc("get_grant_web_search_session",{p_owner_id:this.ownerId,p_search_session_id:searchSessionId});check("get_grant_web_search_session",error);return data?GrantWebSearchSessionSchema.parse(data):null;}
  async saveConfirmedSnapshots(input:Parameters<GrantWebSourceRepository["saveConfirmedSnapshots"]>[0]){const{error}=await this.client.rpc("save_grant_web_source_snapshots",{p_owner_id:this.ownerId,p_search_session_id:input.searchSessionId,p_snapshots:input.snapshots,p_status:input.status});check("save_grant_web_source_snapshots",error);}
  async listSnapshots(searchSessionId:string){const{data,error}=await this.client.rpc("list_grant_web_source_snapshots",{p_owner_id:this.ownerId,p_search_session_id:searchSessionId});check("list_grant_web_source_snapshots",error);return z.array(GrantWebSourceSnapshotSchema).parse(data??[]);}
}

