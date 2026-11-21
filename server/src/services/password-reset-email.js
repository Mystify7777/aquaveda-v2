import nodemailer from "nodemailer";

function smtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM || !SMTP_USER || !SMTP_PASS || !["true", "false"].includes(SMTP_SECURE)) return null;
  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE === "true",
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    from: SMTP_FROM,
  };
}

export async function sendPasswordResetEmail(email, token) {
  const config = smtpConfig();
  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth.password-reset] SMTP is not configured; a password reset email would have been sent.");
      return;
    }
    throw new Error("SMTP is not configured");
  }

  const baseUrl = process.env.FRONTEND_BASE_URL;
  if (!baseUrl) throw new Error("FRONTEND_BASE_URL is not configured");
  const resetUrl = new URL("/auth/reset-password", baseUrl);
  resetUrl.searchParams.set("token", token);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "Reset your AquaVeda password",
    text: `Use this link to reset your AquaVeda password. It expires in one hour.\n\n${resetUrl.toString()}\n\nIf you did not request a password reset, you can ignore this email.`,
  });
}
