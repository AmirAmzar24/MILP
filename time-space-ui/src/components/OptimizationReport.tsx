import { useEffect, useState, useRef } from "react";
import type { ComparisonReport, DirectionMetrics, DeltaMetrics, JunctionMetric, CorridorSnapshot } from "../utils/corridorMetrics";
import TimeSpaceDiagram from "./TimeSpaceDiagram";
import type { J } from "../utils/junctionHelpers";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

type DiagramSettings = {
  timeStart: number;
  timeEnd: number;
  pixelsPerSecond: number;
  pixelsPerMeter: number;
  defaultAmber_s: number;
  defaultRed_s: number;
};

type Props = {
  report: ComparisonReport;
  beforeSnapshot: CorridorSnapshot;
  afterSnapshot: CorridorSnapshot;
  diagramSettings: DiagramSettings;
  onClose: () => void;
};

/** Format a delta value with sign and color class. */
function fmtDelta(
  val: number,
  unit: string,
  inverted = false
): { text: string; className: string } {
  const sign = val > 0 ? "+" : "";
  const isGood = inverted ? val < 0 : val > 0;
  const isBad = inverted ? val > 0 : val < 0;
  return {
    text: val === 0 ? `0${unit}` : `${sign}${val}${unit}`,
    className: isGood
      ? "text-emerald-600 dark:text-emerald-400 font-medium"
      : isBad
        ? "text-red-600 dark:text-red-400 font-medium"
        : "text-neutral-500 dark:text-neutral-400",
  };
}

function DirectionTable({
  label,
  before,
  after,
  delta,
  exporting = false,
}: {
  label: string;
  before: DirectionMetrics;
  after: DirectionMetrics;
  delta: DeltaMetrics;
  exporting?: boolean;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Always show breakdown when exporting to PDF
  const isBreakdownVisible = showBreakdown || exporting;

  const bwDelta = fmtDelta(delta.bandwidth_s, "s");
  const effDelta = fmtDelta(Math.round(delta.progressionEfficiency * 100), "%");
  const stopsDelta = fmtDelta(delta.numStops, "", true);
  const delayDelta = fmtDelta(delta.totalDelay_s, "s", true);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <span
          className={`inline-block w-3 h-3 rounded-sm ${
            label === "Outbound"
              ? "bg-sky-500"
              : "bg-emerald-500"
          }`}
        />
        {label}
      </h3>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-700">
            <th className="text-left py-1.5 px-2 font-medium text-neutral-500 dark:text-neutral-400 w-[30%]">
              Metric
            </th>
            <th className="text-right py-1.5 px-2 font-medium text-neutral-500 dark:text-neutral-400 w-[22%]">
              Before
            </th>
            <th className="text-right py-1.5 px-2 font-medium text-neutral-500 dark:text-neutral-400 w-[22%]">
              After
            </th>
            <th className="text-right py-1.5 px-2 font-medium text-neutral-500 dark:text-neutral-400 w-[26%]">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            <td className="py-1.5 px-2">Bandwidth</td>
            <td className="py-1.5 px-2 text-right">{before.bandwidth_s}s</td>
            <td className="py-1.5 px-2 text-right">{after.bandwidth_s}s</td>
            <td className={`py-1.5 px-2 text-right ${bwDelta.className}`}>{bwDelta.text}</td>
          </tr>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            <td className="py-1.5 px-2" title="Percentage of vehicles that can pass through all junctions without stopping">
              Progression Eff.
            </td>
            <td className="py-1.5 px-2 text-right">{Math.round(before.progressionEfficiency * 100)}%</td>
            <td className="py-1.5 px-2 text-right">{Math.round(after.progressionEfficiency * 100)}%</td>
            <td className={`py-1.5 px-2 text-right ${effDelta.className}`}>{effDelta.text}</td>
          </tr>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            <td className="py-1.5 px-2" title="Stops for a probe vehicle departing at start of green">Stops (probe)</td>
            <td className="py-1.5 px-2 text-right">{before.numStops}</td>
            <td className="py-1.5 px-2 text-right">{after.numStops}</td>
            <td className={`py-1.5 px-2 text-right ${stopsDelta.className}`}>{stopsDelta.text}</td>
          </tr>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            <td className="py-1.5 px-2">Total Delay</td>
            <td className="py-1.5 px-2 text-right">{before.totalDelay_s}s</td>
            <td className="py-1.5 px-2 text-right">{after.totalDelay_s}s</td>
            <td className={`py-1.5 px-2 text-right ${delayDelta.className}`}>{delayDelta.text}</td>
          </tr>
          <tr>
            <td className="py-1.5 px-2">Bottleneck</td>
            <td className="py-1.5 px-2 text-right" title={before.bottleneckReason}>
              {before.bottleneckJunction}
            </td>
            <td className="py-1.5 px-2 text-right" title={after.bottleneckReason}>
              {after.bottleneckJunction}
            </td>
            <td className="py-1.5 px-2 text-right text-neutral-400 dark:text-neutral-500 italic text-[10px]">
              hover for details
            </td>
          </tr>
        </tbody>
      </table>

      {/* Per-junction breakdown toggle - hidden when exporting */}
      {!exporting && (
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="mt-1.5 text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showBreakdown ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Per-junction breakdown
        </button>
      )}

      {/* Per-junction breakdown header when exporting */}
      {exporting && (
        <div className="mt-3 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Per-junction breakdown
        </div>
      )}

      {isBreakdownVisible && (
        <div className="mt-1.5 overflow-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400">
                <th className="text-left py-1 px-1.5 font-medium">Junction</th>
                <th className="text-right py-1 px-1.5 font-medium" colSpan={2}>
                  Eff. Green (s)
                </th>
                <th className="text-right py-1 px-1.5 font-medium" colSpan={2}>
                  Green Ratio
                </th>
                <th className="text-center py-1 px-1.5 font-medium" colSpan={2}>
                  Stopped?
                </th>
                <th className="text-right py-1 px-1.5 font-medium" colSpan={2}>
                  Delay (s)
                </th>
              </tr>
              <tr className="border-b border-neutral-100 dark:border-neutral-800 text-[10px] text-neutral-400 dark:text-neutral-500">
                <th></th>
                <th className="text-right px-1.5">B</th>
                <th className="text-right px-1.5">A</th>
                <th className="text-right px-1.5">B</th>
                <th className="text-right px-1.5">A</th>
                <th className="text-center px-1.5">B</th>
                <th className="text-center px-1.5">A</th>
                <th className="text-right px-1.5">B</th>
                <th className="text-right px-1.5">A</th>
              </tr>
            </thead>
            <tbody>
              {before.perJunction.map((bj, i) => {
                const aj = after.perJunction[i] as JunctionMetric | undefined;
                return (
                  <tr
                    key={bj.name}
                    className="border-b border-neutral-50 dark:border-neutral-800/50"
                  >
                    <td className="py-1 px-1.5 font-medium">{bj.name}</td>
                    <td className="py-1 px-1.5 text-right">{bj.effectiveGreen_s}</td>
                    <td className="py-1 px-1.5 text-right">{aj?.effectiveGreen_s ?? "-"}</td>
                    <td className="py-1 px-1.5 text-right">
                      {(bj.greenRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-1 px-1.5 text-right">
                      {aj ? (aj.greenRatio * 100).toFixed(1) + "%" : "-"}
                    </td>
                    <td className="py-1 px-1.5 text-center">
                      {bj.stopped ? (
                        <span className="text-red-500">Yes</span>
                      ) : (
                        <span className="text-emerald-500">No</span>
                      )}
                    </td>
                    <td className="py-1 px-1.5 text-center">
                      {aj ? (
                        aj.stopped ? (
                          <span className="text-red-500">Yes</span>
                        ) : (
                          <span className="text-emerald-500">No</span>
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-1 px-1.5 text-right">{bj.delay_s}</td>
                    <td className="py-1 px-1.5 text-right">{aj?.delay_s ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OptimizationReport({ report, beforeSnapshot, afterSnapshot, diagramSettings, onClose }: Props) {
  const [exporting, setExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Close on Escape (but not while exporting)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, exporting]);

  const cycleDelta = fmtDelta(report.delta.cycle_s, "s");

  // Compact margins for the report diagrams (larger bottom for bandwidth legend)
  const miniMargins = { left: 80, top: 40, right: 10, bottom: 50 };

  // Scale down diagrams for GUI view in the modal (0.45 = 45% of original size)
  const guiScale = 0.45;
  const guiPps = diagramSettings.pixelsPerSecond * guiScale;
  const guiPpm = diagramSettings.pixelsPerMeter * guiScale;

  // Calculate pixelsPerSecond to fit diagram within target width for PDF
  // Target width ~1000px for better visibility of bandwidth values
  const pdfTargetWidth = 1000;
  const pdfPlotWidth = pdfTargetWidth - miniMargins.left - miniMargins.right;
  const timeRange = diagramSettings.timeEnd - diagramSettings.timeStart;
  const pdfPps = pdfPlotWidth / timeRange;

  // Scale pixelsPerMeter proportionally to maintain aspect ratio
  const pdfScale = pdfPps / diagramSettings.pixelsPerSecond;
  const pdfPpm = diagramSettings.pixelsPerMeter * pdfScale;

  // Detect dark mode
  const isDarkMode = document.documentElement.classList.contains("dark");

  // Export to PDF
  const handleExportPDF = async () => {
    if (!contentRef.current) return;

    setExporting(true);

    // Wait for React to re-render with scaled diagrams
    await new Promise((resolve) => setTimeout(resolve, 150));

    try {
      const content = contentRef.current;

      // Capture the content as canvas - preserve current theme
      const canvas = await html2canvas(content, {
        scale: 2, // Higher resolution
        useCORS: true,
        logging: false,
        backgroundColor: isDarkMode ? "#171717" : "#ffffff", // neutral-900 or white
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      // Create PDF with appropriate dimensions
      // A4 dimensions in points: 595.28 x 841.89
      const pdfWidth = 595.28;
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth;

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: [pdfWidth, Math.max(pdfHeight, 841.89)],
      });

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
      pdf.save(`optimization-report-${timestamp}.pdf`);
    } catch (error) {
      console.error("Failed to export PDF:", error);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-black/50 z-50 ${exporting ? "overflow-auto" : "flex items-center justify-center"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) onClose();
      }}
    >
      <div className={`bg-white dark:bg-neutral-900 rounded-xl shadow-2xl max-w-5xl w-full mx-4 flex flex-col ${exporting ? "my-4" : "max-h-[90vh]"}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-base font-semibold">Optimization Comparison Report</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content — scrollable (or expanded for PDF export) */}
        <div
          ref={contentRef}
          className={`flex-1 p-4 ${exporting ? "overflow-visible" : "overflow-y-auto"}`}
          style={exporting ? { maxHeight: "none" } : undefined}
        >
          {/* Cycle time */}
          <div className="mb-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Cycle Time</span>
              <div className="flex items-center gap-4">
                <span className="text-neutral-500 dark:text-neutral-400">
                  Before: <span className="text-neutral-900 dark:text-neutral-100 font-medium">{report.before.cycle_s}s</span>
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">
                  After: <span className="text-neutral-900 dark:text-neutral-100 font-medium">{report.after.cycle_s}s</span>
                </span>
                <span className={cycleDelta.className}>{cycleDelta.text}</span>
              </div>
            </div>
          </div>

          {/* Outbound */}
          <DirectionTable
            label="Outbound"
            before={report.before.outbound}
            after={report.after.outbound}
            delta={report.delta.outbound}
            exporting={exporting}
          />

          {/* Inbound */}
          <DirectionTable
            label="Inbound"
            before={report.before.inbound}
            after={report.after.inbound}
            delta={report.delta.inbound}
            exporting={exporting}
          />

          {/* Stacked Time-Space Diagrams */}
          <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-700">
            <h3 className="text-sm font-semibold mb-3">Time-Space Diagram Comparison</h3>

            {/* Before Diagram */}
            <div className="mb-4">
              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">
                Before Optimization
              </div>
              <div className={`rounded-lg border-2 border-amber-300 dark:border-amber-600 bg-neutral-50 dark:bg-neutral-800 ${exporting ? "" : "overflow-hidden"}`}>
                <div className={exporting ? "" : "overflow-auto"} style={exporting ? undefined : { maxHeight: "300px" }}>
                  <TimeSpaceDiagram
                    junctions={beforeSnapshot.junctions as J[]}
                    timeStart={diagramSettings.timeStart}
                    timeEnd={diagramSettings.timeEnd}
                    pixelsPerSecond={exporting ? pdfPps : guiPps}
                    pixelsPerMeter={exporting ? pdfPpm : guiPpm}
                    travelOut_s={beforeSnapshot.travelOut_s}
                    travelIn_s={beforeSnapshot.travelIn_s}
                    plotMargins={miniMargins}
                    defaultAmber_s={diagramSettings.defaultAmber_s}
                    defaultRed_s={diagramSettings.defaultRed_s}
                    readOnly={true}
                    hideScrollHint={true}
                  />
                </div>
              </div>
            </div>

            {/* After Diagram */}
            <div>
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">
                After Optimization
              </div>
              <div className={`rounded-lg border-2 border-emerald-300 dark:border-emerald-600 bg-neutral-50 dark:bg-neutral-800 ${exporting ? "" : "overflow-hidden"}`}>
                <div className={exporting ? "" : "overflow-auto"} style={exporting ? undefined : { maxHeight: "300px" }}>
                  <TimeSpaceDiagram
                    junctions={afterSnapshot.junctions as J[]}
                    timeStart={diagramSettings.timeStart}
                    timeEnd={diagramSettings.timeEnd}
                    pixelsPerSecond={exporting ? pdfPps : guiPps}
                    pixelsPerMeter={exporting ? pdfPpm : guiPpm}
                    travelOut_s={afterSnapshot.travelOut_s}
                    travelIn_s={afterSnapshot.travelIn_s}
                    plotMargins={miniMargins}
                    defaultAmber_s={diagramSettings.defaultAmber_s}
                    defaultRed_s={diagramSettings.defaultRed_s}
                    readOnly={true}
                    hideScrollHint={true}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-3">
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
