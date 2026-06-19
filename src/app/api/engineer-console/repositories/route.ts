import { GET as reposGet, POST as reposPost } from "../repos/route";

export const runtime = "nodejs";

export const GET = reposGet;
export const POST = reposPost;
