import React, { useState } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, TextField, IconButton, Button, Chip, CircularProgress, Collapse, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Paper, TableContainer } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import TableChartIcon from "@mui/icons-material/TableChart";
import CodeIcon from "@mui/icons-material/Code";
import Plot from "react-plotly.js";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const CHART_TYPES = ["bar", "line", "pie", "scatter"];

/** Map a chartSpec + rows into Plotly traces. */
function chartData(chartSpec, rows, typeOverride) {
    const type = typeOverride || chartSpec.type;
    const x = rows.map((r) => r[chartSpec.x]);
    const y = rows.map((r) => r[chartSpec.y]);
    if (type === "pie") return [{ type: "pie", labels: x, values: y }];
    if (type === "scatter") return [{ type: "scatter", mode: "markers", x, y }];
    return [{ type, x, y }];
}

/**
 * "Ask your data" — NL question -> validated structured spec -> deterministic
 * rows + chart. The generated spec is shown collapsed ("how I computed this").
 */
const AskDataPanel = ({ open, onClose, fileId, fileName }) => {
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null); // {spec,rows,rowCount,truncated,chartSpec,explanation}
    const [showSpec, setShowSpec] = useState(false);
    const [chartType, setChartType] = useState(null);

    const ask = async () => {
        if (!question.trim() || loading) return;
        setLoading(true);
        setResult(null);
        setChartType(null);
        try {
            const { data } = await axios.post(`/api/v1/files/${fileId}/ask-data`, { question: question.trim() });
            setResult(data);
            setChartType(data.chartSpec?.type || null);
        } catch (e) {
            toast.error(e.response?.data?.message || "Could not answer that");
        } finally {
            setLoading(false);
        }
    };

    const cols = result?.rows?.length ? Object.keys(result.rows[0]) : [];

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                    <TableChartIcon color="primary" />
                    <Typography variant="h6" noWrap sx={{ maxWidth: 420 }}>Ask your data — {fileName}</Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ pb: 3 }}>
                <Box display="flex" gap={1} mb={2}>
                    <TextField
                        fullWidth size="small"
                        placeholder='e.g. "average revenue by region as a bar chart"'
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && ask()}
                    />
                    <Button variant="contained" onClick={ask} disabled={loading || !question.trim()}>
                        {loading ? <CircularProgress size={18} /> : "Ask"}
                    </Button>
                </Box>

                {result && (
                    <>
                        {result.explanation && (
                            <Typography variant="body2" sx={{ mb: 2 }}>{result.explanation}</Typography>
                        )}
                        <Box display="flex" alignItems="center" gap={1} mb={1}>
                            <Chip
                                size="small" icon={<CodeIcon />} variant="outlined"
                                label="How I computed this"
                                onClick={() => setShowSpec((s) => !s)}
                            />
                            <Typography variant="caption" color="text.secondary">
                                {result.rowCount} matching row{result.rowCount === 1 ? "" : "s"}{result.truncated ? " (truncated)" : ""}
                            </Typography>
                            {result.chartSpec && (
                                <Select
                                    size="small" value={chartType || result.chartSpec.type}
                                    onChange={(e) => setChartType(e.target.value)}
                                    sx={{ ml: "auto", height: 28 }}
                                >
                                    {CHART_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                                </Select>
                            )}
                        </Box>
                        <Collapse in={showSpec}>
                            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: "action.hover" }}>
                                <Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                                    {JSON.stringify(result.spec, null, 2)}
                                </Typography>
                            </Paper>
                        </Collapse>

                        {result.chartSpec && result.rows?.length > 0 && (
                            <Plot
                                data={chartData(result.chartSpec, result.rows, chartType)}
                                layout={{ autosize: true, margin: { t: 30, b: 60, l: 50, r: 20 }, paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { color: "#aaa" } }}
                                style={{ width: "100%", height: 320 }}
                                config={{ displayModeBar: false }}
                            />
                        )}

                        {result.rows?.length > 0 && (
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>{cols.map((c) => <TableCell key={c}><b>{c}</b></TableCell>)}</TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {result.rows.slice(0, 100).map((r, i) => (
                                            <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{String(r[c] ?? "")}</TableCell>)}</TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                        {!result.rows?.length && (
                            <Typography variant="body2" color="text.secondary">No rows matched — try broadening the question.</Typography>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default AskDataPanel;
