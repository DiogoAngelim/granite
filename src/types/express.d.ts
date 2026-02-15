import type { UserType } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserType;
      };
    }
  }
}

export { };