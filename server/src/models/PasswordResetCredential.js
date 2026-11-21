import mongoose from "mongoose";

const { Schema } = mongoose;

const passwordResetCredentialSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

passwordResetCredentialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetCredential = mongoose.model(
  "PasswordResetCredential",
  passwordResetCredentialSchema,
);
export default PasswordResetCredential;
