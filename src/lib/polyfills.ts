import { Buffer } from "buffer";
import process from "process";

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: typeof process; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = process;
if (!g.process.env) g.process.env = {};
if (!g.global) g.global = globalThis;
