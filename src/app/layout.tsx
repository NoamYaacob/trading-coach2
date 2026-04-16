import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { BrowserTimeZoneSync } from "@/components/timezone/browser-timezone-sync";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Trading Coach",
    template: "%s | Trading Coach",
  },
  description:
    "Mental coaching infrastructure for traders: onboarding, access control, and Telegram bot foundations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <BrowserTimeZoneSync />
        {children}
      </body>
    </html>
  );
}
