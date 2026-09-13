import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "دليلك البنكي — Social Media Dashboard",
  description: "إدارة منشورات دليلك البنكي من مكان واحد",
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
