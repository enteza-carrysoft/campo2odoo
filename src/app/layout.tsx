import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campo2Odoo — Facturas PDF a Odoo",
  description: "Extrae información de facturas PDF y créalas en Odoo 18",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
