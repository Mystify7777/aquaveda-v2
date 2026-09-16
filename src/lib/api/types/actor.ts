export interface PublicActor {
  _id: string;
  name: string;
  role: "USER" | "EXPERT" | "ADMIN";
}
