import { jsPDF } from "jspdf";
import { autoTable, type CellHookData, type RowInput } from "jspdf-autotable";
import { berlinDate, berlinDateTime } from "../core/time";
import type { ReportDto } from "../dto";
import type { KapTotals, OtherSource } from "../tax/kap";
import type { SoReportDto } from "../tax/so-dto";

// Receipt for the Finanzamt, in German. Every on-chain row carries its transaction signature as a
// Solscan link so anyone can verify it without trusting this tool.

export interface ReceiptInput {
  report: ReportDto;
  totals: KapTotals;
  others: OtherSource[];
  so?: SoReportDto | null;
  generatedAt?: Date;
}

const eur = (x: number) =>
  x.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
const num = (x: number, d = 2) =>
  x.toLocaleString("de-DE", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const dt = berlinDateTime;
const shortSig = (sig: string | null) => (sig ? `${sig.slice(0, 10)}…${sig.slice(-6)}` : "—");
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

const MARGIN = 14;
const ACCENT: [number, number, number] = [79, 70, 229];

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

function heading(doc: Doc, text: string, y: number): number {
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(20);
  doc.text(text, MARGIN, y);
  return y + 6;
}

function paragraph(doc: Doc, text: string, y: number, size = 9): number {
  doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(60);
  const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 2 * MARGIN);
  doc.text(lines, MARGIN, y);
  return y + lines.length * size * 0.42 + 2;
}

const after = (doc: Doc, gap = 8) => (doc.lastAutoTable?.finalY ?? 0) + gap;

/** Turns the cell in `column` into a Solscan link for the row's signature. */
function linkColumn(column: number, signatures: (string | null)[]) {
  return (data: CellHookData) => {
    if (data.section !== "body" || data.column.index !== column) return;
    const sig = signatures[data.row.index];
    if (sig) data.doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: solscan(sig) });
  };
}

const tableBase = {
  margin: { left: MARGIN, right: MARGIN },
  styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4 },
  headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" as const },
  alternateRowStyles: {
    fillColor: [247, 247, 250] as [number, number, number],
  },
};

export function buildReceipt({ report, totals, others, so, generatedAt = new Date() }: ReceiptInput): jsPDF {
  const doc: Doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const year = report.taxYear;
  const othersWithValues = others.filter((o) => o.gainsEur || o.lossesEur);

  // --- Cover ---
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(20);
  doc.text(`Nachweis Krypto-Derivate und -Veräußerungen · Steuerjahr ${year}`, MARGIN, 20);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(`Erstellt mit Perpelster am ${berlinDate(generatedAt)} · Rechenhilfe, keine Steuerberatung`, MARGIN, 26);

  autoTable(doc, {
    ...tableBase,
    startY: 31,
    theme: "plain",
    styles: { ...tableBase.styles, fontSize: 9 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 } },
    body: [
      ["Wallet (Solana)", report.wallet],
      ["Protokolle", report.protocols.length ? report.protocols.join(", ") : "—"],
      ["Zeitraum", `01.01.${year} – 31.12.${year}`],
      ["Datengrundlage", "Transaktionen der Solana-Blockchain; jede Zeile mit Transaktionssignatur (Link auf solscan.io)"],
    ],
  });

  let y = heading(doc, `Anlage KAP ${year} – Termingeschäfte (§ 20 Abs. 2 S. 1 Nr. 3 EStG)`, after(doc, 10));
  const kapRows: RowInput[] = [
    [`Zeile ${report.kap.lineForeignIncome}`, "Ausländische Kapitalerträge (Saldo)", eur(totals.foreignIncomeEur)],
    [`Zeile ${report.kap.lineContainedLosses}`, "Darin enthaltene Verluste", eur(totals.containedLossesEur)],
    ["", `On-chain (${report.protocols.join(", ") || "—"}): Gewinne / Verluste`, `${eur(report.kap.gainsEur)} / ${eur(report.kap.lossesEur)}`],
    ...othersWithValues.map((o) => [
      "",
      `${o.label || "Weitere Plattform"} (Angabe des Steuerpflichtigen): Gewinne / Verluste`,
      `${eur(o.gainsEur)} / ${eur(o.lossesEur)}`,
    ]),
  ];
  autoTable(doc, {
    ...tableBase,
    startY: y,
    head: [["Zeile", "Inhalt", "Betrag"]],
    body: kapRows,
    styles: { ...tableBase.styles, fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 25 },
      2: { halign: "right", cellWidth: 70 },
    },
  });

  const fundingText =
    report.fundingMode === "include"
      ? "Funding-Zahlungen und Borrow-Gebühren sind im Ergebnis enthalten (erhaltene als Gewinn, gezahlte als Verlust)."
      : `Funding-Zahlungen sind nicht enthalten und separat ausgewiesen: erhalten ${eur(report.fundingSeparate.receivedEur)}, gezahlt ${eur(report.fundingSeparate.paidEur)}. Eine amtliche Regelung zur Behandlung fehlt.`;
  y = paragraph(doc, fundingText, after(doc, 6));

  if (so) {
    y = heading(doc, `Anlage SO ${year} – Private Veräußerungsgeschäfte mit Kryptowerten (§ 23 EStG)`, y + 4);
    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [["Zeile", "Inhalt", "Betrag"]],
      body: so.lines.map((l) => [`Zeile ${l.line}`, l.label, l.value]),
      styles: { ...tableBase.styles, fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 25 },
        2: { halign: "right", cellWidth: 70 },
      },
    });
    y = after(doc, 6);
  }

  // --- Method ---
  doc.addPage();
  y = heading(doc, "Methodik", 20);
  const method = [
    "Steuerjahr und Zeitangaben: deutsche Ortszeit (Europe/Berlin). Eine Ausführung am 31.12. um 23:30 UTC gehört zum Folgejahr.",
    "Realisierung: Jede (Teil-)Glattstellung einer Position ist ein eigener Gewinn oder Verlust im Jahr der Glattstellung. Gewinne und Verluste werden je Glattstellung ermittelt, nicht je Position saldiert.",
    "Gebühren: Handelsgebühren der Glattstellung mindern das Ergebnis direkt. Eröffnungsgebühren werden als Anschaffungsnebenkosten mitgeführt und anteilig zur geschlossenen Positionsgröße verrechnet.",
    `Währungsumrechnung: ${report.fxSource}.`,
    "Datenquellen: Phoenix über die öffentliche API von perp-api.phoenix.trade (jede Ausführung mit Transaktionssignatur); Jupiter Perps durch Dekodierung der On-Chain-Events des Programms PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu.",
    "Nachprüfbarkeit: Jede Zeile in Anlage A und B verweist auf die Transaktion auf solscan.io. Die Angaben weiterer Plattformen stammen vom Steuerpflichtigen und sind durch deren Berichte zu belegen.",
    ...(so ? so.method : []),
  ];
  for (const m of method) y = paragraph(doc, `• ${m}`, y + 1);
  const notes = [...report.notes, ...(so?.warnings ?? [])];
  if (notes.length) {
    y = heading(doc, "Hinweise", y + 6);
    for (const n of notes) y = paragraph(doc, `• ${n}`, y + 1);
  }

  // --- Appendix A: closes (skipped for spot-only wallets) ---
  if (report.realizations.length) {
    doc.addPage();
    heading(doc, `Anlage A – Glattstellungen ${year} (${report.realizations.length})`, 20);
    autoTable(doc, {
      ...tableBase,
      startY: 25,
      head: [
        [
          "Zeit (Berlin)",
          "Protokoll",
          "Markt",
          "Seite",
          "Art",
          "Größe USD",
          "Preis",
          "PnL USD",
          "EZB USD/EUR",
          "PnL EUR",
          "Gebühren EUR",
          "Ergebnis EUR",
          "Transaktion",
        ],
      ],
      body: report.realizations.map((r) => [
        dt(r.time),
        r.protocol,
        r.market,
        r.side,
        r.kind,
        num(r.sizeUsd),
        num(r.price, r.price < 10 ? 4 : 2),
        num(r.pnlUsd),
        `${num(r.ecbRate, 4)} (${r.ecbDate})`,
        num(r.pnlEur),
        num(r.feeEur),
        num(r.resultEur),
        shortSig(r.signature),
      ]),
      columnStyles: {
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        9: { halign: "right" },
        10: { halign: "right" },
        11: { halign: "right" },
        12: { textColor: ACCENT },
      },
      didDrawCell: linkColumn(
        12,
        report.realizations.map((r) => r.signature),
      ),
    });
  }

  // --- Appendix B: all fills ---
  if (report.fills.length) {
    doc.addPage();
    heading(doc, `Anlage B – Alle Ausführungen ${year} (${report.fills.length})`, 20);
    autoTable(doc, {
      ...tableBase,
      startY: 25,
      head: [["Zeit (Berlin)", "Protokoll", "Markt", "Seite", "Art", "Größe USD", "Preis", "Gebühr USD", "Funding/Borrow USD", "Transaktion"]],
      body: report.fills.map((f) => [
        dt(f.time),
        f.protocol,
        f.market,
        f.side,
        f.kind,
        num(f.sizeUsd),
        num(f.price, f.price < 10 ? 4 : 2),
        num(f.feeUsd, 4),
        num(f.fundingUsd, 4),
        shortSig(f.signature),
      ]),
      columnStyles: {
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { textColor: ACCENT },
      },
      didDrawCell: linkColumn(
        9,
        report.fills.map((f) => f.signature),
      ),
    });
  }

  // --- Appendix C: funding ---
  if (report.fundingMonthly.length) {
    doc.addPage();
    heading(doc, `Anlage C – Funding-Zahlungen ${year} je Monat und Markt`, 20);
    paragraph(doc, "Funding wird stündlich verrechnet. Einzelbuchungen enthält die Ledger-CSV.", 25);
    autoTable(doc, {
      ...tableBase,
      startY: 30,
      head: [["Monat", "Protokoll", "Markt", "Zahlungen", "Erhalten EUR", "Gezahlt EUR", "Saldo EUR"]],
      body: report.fundingMonthly.map((f) => [
        f.month,
        f.protocol,
        f.market,
        String(f.payments),
        num(f.receivedEur),
        num(f.paidEur),
        num(f.receivedEur - f.paidEur),
      ]),
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });
  }

  // --- Appendix D: spot disposals ---
  if (so && so.disposals.length) {
    doc.addPage();
    heading(doc, `Anlage D – Veräußerungen von Kryptowerten ${year} (FIFO, ${so.disposals.length})`, 20);
    paragraph(
      doc,
      "* Anschaffungskosten unbekannt (Token per Übertragung erhalten) und mit 0 € angesetzt. A = Kaufdatum und Anschaffungskosten laut Angabe des Steuerpflichtigen (Belege der Börse).",
      25,
      8,
    );
    autoTable(doc, {
      ...tableBase,
      startY: 29,
      head: [
        [
          "Veräußert (Berlin)",
          "Token",
          "Handelsplatz",
          "Menge",
          "Angeschafft",
          "Haltedauer",
          "Erlös EUR",
          "Anschaffung EUR",
          "Gebühr EUR",
          "Gewinn EUR",
          "Steuerfrei",
          "Transaktion",
        ],
      ],
      body: so.disposals.map((d) => [
        dt(d.time),
        d.token,
        d.venue,
        num(d.amount, 6),
        (d.acquiredAt ? berlinDate(d.acquiredAt) : "unbekannt") + (d.basisKnown ? "" : " *") + (d.basisFromUser ? " A" : ""),
        `${d.holdingDays} T`,
        num(d.proceedsEur),
        num(d.costEur),
        num(d.feeEur),
        num(d.gainEur),
        d.taxFree ? "ja (> 1 Jahr)" : "nein",
        shortSig(d.signature),
      ]),
      columnStyles: {
        3: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
        11: { textColor: ACCENT },
      },
      didDrawCell: linkColumn(
        11,
        so.disposals.map((d) => d.signature),
      ),
    });
  }

  // --- Footer on every page ---
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(130);
    const h = doc.internal.pageSize.getHeight();
    doc.text(`Perpelster · ${report.wallet} · Steuerjahr ${year}`, MARGIN, h - 7);
    doc.text(`Seite ${i} von ${pages}`, doc.internal.pageSize.getWidth() - MARGIN, h - 7, { align: "right" });
  }
  return doc;
}
