// netlify/functions/send-email.js
import { Resend } from "resend";
import fetch from "node-fetch";

const resend = new Resend(process.env.RESEND_API_KEY);

// In-memory request counter for basic DDoS mitigation
const requestCounts = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_IP = 5;

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "https://jaswins.com", // Only allow your domain
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  // Handle preflight (OPTIONS) request for CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method Not Allowed" };
  }

  try {
    // --- Rate limiting ---
    const ip =
      event.headers["x-forwarded-for"]?.split(",")[0] ||
      event.headers["client-ip"] ||
      "unknown";

    const now = Date.now();
    requestCounts[ip] = requestCounts[ip]?.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW
    ) || [];

    if (requestCounts[ip].length >= MAX_REQUESTS_PER_IP) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ success: false, error: "Too many requests" })
      };
    }
    requestCounts[ip].push(now);

    // --- Payload size check ---
    if (event.body.length > 5000) {
      return {
        statusCode: 413,
        headers,
        body: JSON.stringify({ success: false, error: "Payload too large" })
      };
    }

    // --- Parse & validate form data ---
    const formData = JSON.parse(event.body);

    if (
      !formData.name ||
      !formData.email ||
      !formData.message ||
      !formData.token || // reCAPTCHA token from frontend
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "Invalid input" })
      };
    }

    // --- Verify reCAPTCHA ---
    const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
    const recaptchaResponse = await fetch(
      `https://www.google.com/recaptcha/api/siteverify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${recaptchaSecret}&response=${formData.token}`
      }
    );

    const recaptchaData = await recaptchaResponse.json();

    if (!recaptchaData.success || recaptchaData.score < 0.5) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: "reCAPTCHA failed" })
      };
    }

    // --- Simple spam word filter ---
    const spamKeywords = ["viagra", "free money", "casino", "loan"];
    if (
      spamKeywords.some((word) =>
        `${formData.name} ${formData.message}`.toLowerCase().includes(word)
      )
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "Spam detected" })
      };
    }

    // --- Send email via Resend ---
    const { error } = await resend.emails.send({
      from: "Enquiry <sales@jaswins.com>",
      to: ["sales@jaswins.com"],
      subject: `New message from ${formData.name}`,
      html: `<p><strong>Name:</strong> ${formData.name}</p>
             <p><strong>Email:</strong> ${formData.email}</p>
             <p><strong>Message:</strong> ${formData.message}</p>`
    });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
}
