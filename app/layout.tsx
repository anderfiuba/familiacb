import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Public_Sans } from "next/font/google";
import "./globals.css";

const titulo = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-titulo", weight: ["500", "600", "700"] });
const corpo = Public_Sans({ subsets: ["latin"], variable: "--font-corpo", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "familiacb",
  description: "Reais para pesos, da família para a família.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#F3F5F2", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${titulo.variable} ${corpo.variable}`}>
      <body className="min-h-dvh font-corpo antialiased">{children}</body>
    </html>
  );
}
