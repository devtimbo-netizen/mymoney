import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "My Money",
  description: "A personal balance tracker. You enter the numbers; it keeps the running total.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="mm-backdrop" aria-hidden="true">
          <div className="mm-wave mm-wave--gold-1" />
          <div className="mm-wave mm-wave--blue-1" />
          <div className="mm-wave mm-wave--gold-2" />
          <div className="mm-wave mm-wave--blue-2" />
          <div className="mm-veil" />
        </div>
        {children}
      </body>
    </html>
  );
}
