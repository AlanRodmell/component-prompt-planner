import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "component-prompt-planner:v1";
const NODE_W = 250;
const HEADER_H = 44;
const ROW_H = 22;
const PAD = 10;

const uid = () => Math.random().toString(36).slice(2, 9);

function createInitialNodes() {
  return [
    {
      id: "root",
      name: "App",
      description: "Owns the page-level flow and composes the feature.",
      x: 300,
      y: 50,
      state: [{ id: uid(), name: "user", type: "object" }],
    },
  ];
}

function loadDraft() {
  if (typeof window === "undefined") {
    return { brief: "", nodes: createInitialNodes(), edges: [] };
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges)) {
      return {
        brief: typeof saved.brief === "string" ? saved.brief : "",
        nodes: saved.nodes,
        edges: saved.edges,
      };
    }
  } catch {
    // Start with a clean draft if local storage contains invalid data.
  }

  return { brief: "", nodes: createInitialNodes(), edges: [] };
}

function nodeHeight(node) {
  const descriptionHeight = node.description?.trim() ? 38 : 0;
  const stateHeight = node.state.length ? PAD * 2 + node.state.length * ROW_H : 16;
  return HEADER_H + descriptionHeight + stateHeight;
}

function makeNode(x, y, name = "NewComponent") {
  return { id: uid(), name, description: "", x, y, state: [] };
}

function makeEdge(source, target) {
  return { id: uid(), source, target, props: [], events: [] };
}

function formatItem(item, fallback) {
  const name = item.name?.trim() || fallback;
  return `${name}${item.type?.trim() ? ` (${item.type.trim()})` : ""}`;
}

function buildPrompt(brief, nodes, edges) {
  const nodeName = (id) => nodes.find((node) => node.id === id)?.name?.trim() || "Unnamed component";

  const componentSections = nodes.map((node, index) => {
    const incoming = edges.filter((edge) => edge.target === node.id);
    const outgoing = edges.filter((edge) => edge.source === node.id);
    const state = node.state.length
      ? node.state.map((item) => `     - ${formatItem(item, "unnamedState")}`).join("\n")
      : "     - None defined";
    const parents = incoming.length
      ? incoming.map((edge) => nodeName(edge.source)).join(", ")
      : "None / root component";
    const children = outgoing.length
      ? outgoing.map((edge) => nodeName(edge.target)).join(", ")
      : "None";

    return `${index + 1}. ${node.name?.trim() || "Unnamed component"}\n` +
      `   - Responsibility: ${node.description?.trim() || "Clarify from the source requirements."}\n` +
      `   - Parent(s): ${parents}\n` +
      `   - Renders: ${children}\n` +
      `   - Local state:\n${state}`;
  }).join("\n\n");

  const connectionSections = edges.length
    ? edges.map((edge) => {
        const props = edge.props.length
          ? edge.props.map((item) => formatItem(item, "unnamedProp")).join(", ")
          : "None defined";
        const events = edge.events.length
          ? edge.events.map((event) => {
              const name = event.name?.trim() || "unnamedEvent";
              return `${name}${event.desc?.trim() ? ` — ${event.desc.trim()}` : ""}`;
            }).join(", ")
          : "None defined";

        return `- ${nodeName(edge.source)} → ${nodeName(edge.target)}\n` +
          `  - Props passed down: ${props}\n` +
          `  - Events emitted up: ${events}`;
      }).join("\n")
    : "- No component relationships have been defined yet.";

  const sourceRequirements = brief.trim() || "No source requirements were supplied. Use the component plan below and explicitly flag any missing behaviour before implementation.";

  return `You are working in an existing React codebase. Review the relevant repository files before making changes.\n\n` +
    `## Goal\n\n` +
    `Implement the feature described in the source requirements using the agreed component plan. Preserve existing project conventions, reuse existing components and utilities, and avoid unrelated changes.\n\n` +
    `## Source requirements\n\n` +
    `<requirements>\n${sourceRequirements}\n</requirements>\n\n` +
    `## Agreed component plan\n\n${componentSections || "No components have been defined."}\n\n` +
    `## Data flow\n\n${connectionSections}\n\n` +
    `## Implementation approach\n\n` +
    `1. Inspect the current routes, components, state ownership, data-fetching patterns, and tests that this feature will touch.\n` +
    `2. Reconcile the source requirements with the component and data-flow plan above. Do not silently invent behaviour where either is unclear.\n` +
    `3. Implement the smallest cohesive change that satisfies the requirements and follows the existing code style.\n` +
    `4. Keep state in the component that owns it, pass the listed props downward, and use the listed events for upward communication.\n` +
    `5. Add or update focused tests for the changed behaviour and run the relevant checks.\n\n` +
    `## Deliverables\n\n` +
    `- Working implementation\n` +
    `- Focused tests\n` +
    `- A concise summary of files changed, decisions made, and any remaining ambiguity`;
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed"));
}

export default function ComponentPlanner() {
  const [initialDraft] = useState(loadDraft);
  const [brief, setBrief] = useState(initialDraft.brief);
  const [nodes, setNodes] = useState(initialDraft.nodes);
  const [edges, setEdges] = useState(initialDraft.edges);
  const [selected, setSelected] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [showBrief, setShowBrief] = useState(!initialDraft.brief.trim());
  const [showExport, setShowExport] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [confirmReset, setConfirmReset] = useState(false);
  const [deletedItem, setDeletedItem] = useState(null);
  const [renameNodeId, setRenameNodeId] = useState(null);

  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const nameInputRef = useRef(null);
  const requirementsFileRef = useRef(null);
  const copyTimerRef = useRef(null);

  const selectedNode = selected?.type === "node"
    ? nodes.find((node) => node.id === selected.id)
    : null;
  const selectedEdge = selected?.type === "edge"
    ? edges.find((edge) => edge.id === selected.id)
    : null;

  const generatedPrompt = useMemo(
    () => buildPrompt(brief, nodes, edges),
    [brief, nodes, edges],
  );

  const canvasSize = useMemo(() => ({
    width: Math.max(920, ...nodes.map((node) => node.x + NODE_W + 180)),
    height: Math.max(620, ...nodes.map((node) => node.y + nodeHeight(node) + 180)),
  }), [nodes]);

  useEffect(() => {
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ brief, nodes, edges }));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [brief, nodes, edges]);

  useEffect(() => {
    if (renameNodeId && selectedNode?.id === renameNodeId) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [renameNodeId, selectedNode?.id]);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const getCanvasPoint = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left + canvas.scrollLeft,
      y: clientY - rect.top + canvas.scrollTop,
    };
  }, []);

  const addConnection = useCallback((source, target) => {
    if (!target || source === target || edges.some((edge) => edge.source === source && edge.target === target)) {
      setConnecting(null);
      return;
    }

    const edge = makeEdge(source, target);
    setEdges((current) => [...current, edge]);
    setSelected({ type: "edge", id: edge.id });
    setConnecting(null);
  }, [edges]);

  const onNodePointerDown = (event, id) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    if (connecting?.mode === "choose") {
      addConnection(connecting.source, id);
      return;
    }

    const node = nodes.find((item) => item.id === id);
    const point = getCanvasPoint(event.clientX, event.clientY);
    dragRef.current = { id, offX: point.x - node.x, offY: point.y - node.y };
    setSelected({ type: "node", id });
  };

  const onHandlePointerDown = (event, id) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getCanvasPoint(event.clientX, event.clientY);
    setConnecting({
      source: id,
      x: point.x,
      y: point.y,
      startX: event.clientX,
      startY: event.clientY,
      mode: "pending",
    });
    setSelected({ type: "node", id });
  };

  useEffect(() => {
    const onMove = (event) => {
      if (dragRef.current) {
        const point = getCanvasPoint(event.clientX, event.clientY);
        const { id, offX, offY } = dragRef.current;
        setNodes((current) => current.map((node) => (
          node.id === id
            ? { ...node, x: Math.max(12, point.x - offX), y: Math.max(12, point.y - offY) }
            : node
        )));
        return;
      }

      if (connecting && connecting.mode !== "choose") {
        const point = getCanvasPoint(event.clientX, event.clientY);
        const moved = Math.hypot(
          event.clientX - connecting.startX,
          event.clientY - connecting.startY,
        ) > 5;
        setConnecting((current) => current ? {
          ...current,
          x: point.x,
          y: point.y,
          mode: moved ? "drag" : current.mode,
        } : current);
      }
    };

    const onUp = (event) => {
      dragRef.current = null;
      if (!connecting || connecting.mode === "choose") return;

      if (connecting.mode === "drag") {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const target = element?.closest("[data-node-id]")?.getAttribute("data-node-id");
        addConnection(connecting.source, target);
      } else {
        setConnecting((current) => current ? { ...current, mode: "choose" } : current);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [addConnection, connecting, getCanvasPoint]);

  const findOpenPosition = () => {
    const canvas = canvasRef.current;
    const startX = (canvas?.scrollLeft || 0) + 40;
    const startY = (canvas?.scrollTop || 0) + 70;

    for (let index = 0; index < 60; index += 1) {
      const x = startX + (index % 3) * 285;
      const y = startY + Math.floor(index / 3) * 170;
      const overlaps = nodes.some((node) => (
        Math.abs(node.x - x) < NODE_W && Math.abs(node.y - y) < 130
      ));
      if (!overlaps) return { x, y };
    }

    return { x: startX, y: startY + nodes.length * 30 };
  };

  const addNode = () => {
    const position = findOpenPosition();
    const node = makeNode(position.x, position.y);
    setNodes((current) => [...current, node]);
    setSelected({ type: "node", id: node.id });
    setRenameNodeId(node.id);
    setConnecting(null);
  };

  const updateNode = (id, patch) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...patch } : node));
  };

  const updateEdge = (id, patch) => {
    setEdges((current) => current.map((edge) => edge.id === id ? { ...edge, ...patch } : edge));
  };

  const deleteSelected = useCallback(() => {
    if (!selected) return;

    if (selected.type === "node") {
      const node = nodes.find((item) => item.id === selected.id);
      const linkedEdges = edges.filter((edge) => edge.source === selected.id || edge.target === selected.id);
      if (!node) return;
      setDeletedItem({ type: "node", node, edges: linkedEdges });
      setNodes((current) => current.filter((item) => item.id !== selected.id));
      setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id));
    } else {
      const edge = edges.find((item) => item.id === selected.id);
      if (!edge) return;
      setDeletedItem({ type: "edge", edge });
      setEdges((current) => current.filter((item) => item.id !== selected.id));
    }

    setSelected(null);
    setConnecting(null);
  }, [edges, nodes, selected]);

  const undoDelete = () => {
    if (!deletedItem) return;
    if (deletedItem.type === "node") {
      setNodes((current) => [...current, deletedItem.node]);
      setEdges((current) => [...current, ...deletedItem.edges]);
      setSelected({ type: "node", id: deletedItem.node.id });
    } else {
      setEdges((current) => [...current, deletedItem.edge]);
      setSelected({ type: "edge", id: deletedItem.edge.id });
    }
    setDeletedItem(null);
  };

  const resetPlanner = () => {
    setBrief("");
    setNodes(createInitialNodes());
    setEdges([]);
    setSelected(null);
    setConnecting(null);
    setDeletedItem(null);
    setConfirmReset(false);
    setShowBrief(true);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

      if (event.key === "Escape") {
        setConnecting(null);
        setShowExport(false);
        setConfirmReset(false);
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selected && !isTyping) {
        event.preventDefault();
        deleteSelected();
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        setShowExport(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, selected]);

  const handleCopy = async () => {
    window.clearTimeout(copyTimerRef.current);
    try {
      await copyToClipboard(generatedPrompt);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    copyTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), 1800);
  };

  const downloadPrompt = () => {
    const blob = new Blob([generatedPrompt], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "implementation-prompt.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const importRequirements = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setBrief(await file.text());
      setShowBrief(true);
    } catch {
      setSaveStatus("error");
    }
  };

  const handlePosition = (node, edge) => ({
    x: node.x + NODE_W / 2,
    y: edge === "top" ? node.y : node.y + nodeHeight(node),
  });

  return (
    <div className="cp-root">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .cp-root { min-height: 680px; height: 100vh; background: #101319; color: #e7e9ee; display: flex; flex-direction: column; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .cp-toolbar { min-height: 68px; padding: 10px 16px; border-bottom: 1px solid #242935; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #141820; }
        .cp-brand { min-width: 210px; }
        .cp-title { font-size: 15px; font-weight: 700; letter-spacing: 0.01em; }
        .cp-subtitle { margin-top: 3px; color: #8f98aa; font-size: 11px; }
        .cp-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
        .cp-meta { color: #8f98aa; font-size: 11px; white-space: nowrap; }
        .cp-btn { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 11px; border: 1px solid #343b4b; border-radius: 7px; background: #1c212b; color: #e7e9ee; font-size: 12px; font-weight: 600; cursor: pointer; }
        .cp-btn:hover { border-color: #65aaff; background: #222a36; }
        .cp-btn.primary { background: #2d6fc3; border-color: #65aaff; color: white; }
        .cp-btn.primary:hover { background: #377dd0; }
        .cp-btn.danger { border-color: #7f3e49; color: #ff9aa8; }
        .cp-btn.compact { min-height: 29px; padding: 5px 8px; font-size: 11px; }
        .cp-iconbtn { width: 30px; height: 30px; padding: 0; display: inline-grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #8f98aa; font-size: 18px; cursor: pointer; }
        .cp-iconbtn:hover { color: #fff; background: #282e3a; }
        .cp-confirm { display: inline-flex; align-items: center; gap: 6px; padding-left: 8px; border-left: 1px solid #343b4b; color: #bec5d1; font-size: 11px; }
        .cp-brief { padding: 12px 16px 14px; border-bottom: 1px solid #242935; background: #171b23; }
        .cp-brief-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
        .cp-brief-tools { display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
        .cp-label { color: #c8cfdb; font-size: 12px; font-weight: 650; }
        .cp-hint { color: #7f899c; font-size: 11px; }
        .cp-textarea, .cp-input { width: 100%; padding: 8px 9px; border: 1px solid #343b4b; border-radius: 7px; background: #1c212b; color: #e7e9ee; font: inherit; font-size: 12px; }
        .cp-textarea { min-height: 104px; max-height: 240px; resize: vertical; line-height: 1.5; }
        .cp-textarea:focus, .cp-input:focus { outline: 2px solid rgba(94, 168, 255, 0.25); border-color: #5ea8ff; }
        .cp-workspace { flex: 1; min-height: 0; display: flex; }
        .cp-canvas { flex: 1; min-width: 0; min-height: 500px; overflow: auto; position: relative; background-color: #101319; background-image: radial-gradient(circle, #29303d 1px, transparent 1px); background-size: 22px 22px; }
        .cp-canvas-content { position: relative; }
        .cp-connection-tip { position: sticky; left: 16px; top: 14px; z-index: 12; width: max-content; max-width: calc(100% - 32px); padding: 8px 11px; border: 1px solid #8a622e; border-radius: 7px; background: #2a2117; color: #ffd18b; box-shadow: 0 7px 22px rgba(0,0,0,0.25); font-size: 11px; pointer-events: none; }
        .cp-node { position: absolute; width: ${NODE_W}px; border: 1.5px solid #343b4b; border-radius: 9px; background: #1c212b; box-shadow: 0 7px 20px rgba(0,0,0,0.16); cursor: grab; user-select: none; touch-action: none; }
        .cp-node:hover { border-color: #526077; }
        .cp-node.selected { border-color: #5ea8ff; box-shadow: 0 0 0 2px rgba(94,168,255,0.15), 0 8px 24px rgba(0,0,0,0.2); }
        .cp-node-title { height: ${HEADER_H}px; padding: 11px 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid #2a303c; font: 650 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
        .cp-node-description { height: 38px; padding: 7px 13px; overflow: hidden; color: #9ca6b8; font-size: 10px; line-height: 1.25; }
        .cp-state-list { padding: 8px 13px 10px; }
        .cp-state { overflow: hidden; color: #b9a6ff; font: 10px/22px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
        .cp-empty-state { height: 16px; }
        .cp-handle { position: absolute; left: 50%; width: 14px; height: 14px; transform: translateX(-50%); border: 2px solid #101319; border-radius: 50%; background: #5ea8ff; cursor: crosshair; }
        .cp-handle.out { bottom: -8px; }
        .cp-handle.in { top: -7px; width: 12px; height: 12px; background: #101319; border-color: #5ea8ff; pointer-events: none; }
        .cp-empty-canvas { position: absolute; top: 42%; left: 50%; transform: translate(-50%, -50%); width: 280px; padding: 24px; border: 1px dashed #3a4354; border-radius: 10px; color: #8f98aa; text-align: center; font-size: 12px; line-height: 1.5; }
        .cp-inspector { width: 340px; flex: 0 0 340px; padding: 16px; overflow-y: auto; border-left: 1px solid #242935; background: #151920; }
        .cp-inspector-empty { color: #8f98aa; font-size: 12px; line-height: 1.55; }
        .cp-step { display: grid; grid-template-columns: 20px 1fr; gap: 7px; margin-bottom: 10px; }
        .cp-step-number { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; background: #273247; color: #8ec1ff; font-size: 10px; font-weight: 700; }
        .cp-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
        .cp-section-label { margin: 15px 0 7px; color: #8f98aa; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
        .cp-field { margin-bottom: 10px; }
        .cp-field-label { display: block; margin-bottom: 5px; color: #adb5c4; font-size: 10px; font-weight: 650; }
        .cp-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.9fr) 30px; align-items: center; gap: 6px; margin-bottom: 6px; }
        .cp-row.event { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) 30px; }
        .cp-relationship { margin: -2px 0 12px; padding: 8px 10px; border-radius: 6px; background: #1d222c; color: #bac2cf; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
        .cp-toast { position: fixed; z-index: 40; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 9px 12px; border: 1px solid #3d4657; border-radius: 8px; background: #202631; box-shadow: 0 8px 30px rgba(0,0,0,0.35); color: #d9dee7; font-size: 12px; }
        .cp-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,0.68); }
        .cp-modal { width: min(820px, 96vw); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #343b4b; border-radius: 11px; background: #161a21; box-shadow: 0 20px 70px rgba(0,0,0,0.45); }
        .cp-modal-head { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #29303b; }
        .cp-modal-title { font-size: 13px; font-weight: 700; }
        .cp-modal-subtitle { margin-top: 3px; color: #858fa1; font-size: 10px; }
        .cp-modal-actions { display: flex; align-items: center; gap: 7px; }
        .cp-prompt { margin: 0; padding: 18px; overflow: auto; color: #cbd1dc; font: 11px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
        @media (max-width: 820px) {
          .cp-root { height: auto; min-height: 100vh; }
          .cp-toolbar { align-items: flex-start; flex-direction: column; }
          .cp-actions { width: 100%; justify-content: flex-start; }
          .cp-workspace { flex-direction: column; }
          .cp-canvas { min-height: 520px; max-height: 62vh; }
          .cp-inspector { width: 100%; flex-basis: auto; min-height: 260px; max-height: none; border-top: 1px solid #242935; border-left: 0; }
          .cp-modal-head { align-items: flex-start; flex-direction: column; }
          .cp-modal-actions { width: 100%; }
        }
      `}</style>

      <header className="cp-toolbar">
        <div className="cp-brand">
          <div className="cp-title">Component prompt planner</div>
          <div className="cp-subtitle">
            {nodes.length} component{nodes.length === 1 ? "" : "s"} · {edges.length} connection{edges.length === 1 ? "" : "s"} · {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Not saved" : "Saved locally"}
          </div>
        </div>

        <div className="cp-actions">
          <button className="cp-btn" onClick={() => setShowBrief((current) => !current)}>
            {showBrief ? "Hide requirements" : "Requirements"}
          </button>
          {confirmReset ? (
            <span className="cp-confirm">
              Clear this draft?
              <button className="cp-btn compact" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="cp-btn compact danger" onClick={resetPlanner}>Clear</button>
            </span>
          ) : (
            <button className="cp-btn" onClick={() => setConfirmReset(true)}>New plan</button>
          )}
          <button className="cp-btn" onClick={addNode}>+ Component</button>
          <button className="cp-btn primary" onClick={() => setShowExport(true)}>Generate prompt</button>
        </div>
      </header>

      {showBrief && (
        <section className="cp-brief">
          <div className="cp-brief-head">
            <label className="cp-label" htmlFor="source-requirements">Source requirements</label>
            <div className="cp-brief-tools">
              <span className="cp-hint">{brief.length.toLocaleString()} characters</span>
              <input
                ref={requirementsFileRef}
                type="file"
                accept=".md,.txt,.json,text/markdown,text/plain,application/json"
                hidden
                onChange={importRequirements}
              />
              <button className="cp-btn compact" onClick={() => requirementsFileRef.current?.click()}>
                Import text file
              </button>
            </div>
          </div>
          <textarea
            id="source-requirements"
            className="cp-textarea"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Paste the requirements that the generated implementation prompt should preserve…"
          />
        </section>
      )}

      <main className="cp-workspace">
        <div ref={canvasRef} className="cp-canvas">
          <div
            className="cp-canvas-content"
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelected(null);
                if (connecting?.mode === "choose") setConnecting(null);
              }
            }}
          >
            {connecting && (
              <div className="cp-connection-tip">
                {connecting.mode === "choose"
                  ? `Select the child for ${nodes.find((node) => node.id === connecting.source)?.name || "this component"} · Esc cancels`
                  : "Drag onto a child component, or release and then select it"}
              </div>
            )}

            <svg width={canvasSize.width} height={canvasSize.height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <defs>
                <marker id="cp-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#5ea8ff" />
                </marker>
                <marker id="cp-arrow-selected" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#ffb454" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const source = nodes.find((node) => node.id === edge.source);
                const target = nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const start = handlePosition(source, "bottom");
                const end = handlePosition(target, "top");
                const selectedConnection = selectedEdge?.id === edge.id;
                const middleY = (start.y + end.y) / 2;
                const path = `M${start.x},${start.y} C${start.x},${middleY} ${end.x},${middleY} ${end.x},${end.y}`;

                return (
                  <g
                    key={edge.id}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelected({ type: "edge", id: edge.id });
                    }}
                  >
                    <path d={path} stroke="transparent" strokeWidth="16" fill="none" />
                    <path
                      d={path}
                      stroke={selectedConnection ? "#ffb454" : "#5ea8ff"}
                      strokeWidth={selectedConnection ? 2.6 : 1.6}
                      fill="none"
                      markerEnd={selectedConnection ? "url(#cp-arrow-selected)" : "url(#cp-arrow)"}
                    />
                    {(edge.props.length > 0 || edge.events.length > 0) && (
                      <text x={(start.x + end.x) / 2 + 8} y={middleY} fontSize="10" fill="#8f98aa">
                        {edge.props.length ? `${edge.props.length} prop${edge.props.length === 1 ? "" : "s"}` : ""}
                        {edge.props.length && edge.events.length ? " / " : ""}
                        {edge.events.length ? `${edge.events.length} event${edge.events.length === 1 ? "" : "s"}` : ""}
                      </text>
                    )}
                  </g>
                );
              })}

              {connecting && connecting.mode !== "choose" && (() => {
                const source = nodes.find((node) => node.id === connecting.source);
                if (!source) return null;
                const start = handlePosition(source, "bottom");
                return (
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={connecting.x}
                    y2={connecting.y}
                    stroke="#ffb454"
                    strokeWidth="1.7"
                    strokeDasharray="5,4"
                  />
                );
              })()}
            </svg>

            {nodes.map((node) => {
              const isSelected = selected?.type === "node" && selected.id === node.id;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  className={`cp-node${isSelected ? " selected" : ""}`}
                  onPointerDown={(event) => onNodePointerDown(event, node.id)}
                  onDoubleClick={() => {
                    setSelected({ type: "node", id: node.id });
                    setRenameNodeId(node.id);
                  }}
                  style={{ left: node.x, top: node.y, minHeight: nodeHeight(node) }}
                >
                  <div className="cp-handle in" />
                  <div className="cp-node-title">{node.name || "Unnamed component"}</div>
                  {node.description?.trim() && <div className="cp-node-description">{node.description}</div>}
                  {node.state.length ? (
                    <div className="cp-state-list">
                      {node.state.map((item) => (
                        <div className="cp-state" key={item.id}>
                          state: {item.name || "—"}{item.type ? `: ${item.type}` : ""}
                        </div>
                      ))}
                    </div>
                  ) : <div className="cp-empty-state" />}
                  <div
                    className="cp-handle out"
                    title="Drag to a child, or click and then select a child"
                    onPointerDown={(event) => onHandlePointerDown(event, node.id)}
                  />
                </div>
              );
            })}

            {!nodes.length && (
              <div className="cp-empty-canvas">
                Your plan has no components yet.<br />
                <button className="cp-btn" style={{ marginTop: 12 }} onClick={addNode}>+ Add the first component</button>
              </div>
            )}
          </div>
        </div>

        <aside className="cp-inspector">
          {!selected && (
            <div className="cp-inspector-empty">
              <div className="cp-section-label" style={{ marginTop: 0 }}>Quick workflow</div>
              <div className="cp-step"><span className="cp-step-number">1</span><span>Paste the source brief or technical requirements.</span></div>
              <div className="cp-step"><span className="cp-step-number">2</span><span>Add components and describe each responsibility.</span></div>
              <div className="cp-step"><span className="cp-step-number">3</span><span>Use the blue dot to connect parents to children, then describe props and events.</span></div>
              <div className="cp-step"><span className="cp-step-number">4</span><span>Generate and copy the implementation prompt.</span></div>
              <div className="cp-section-label">Useful shortcuts</div>
              <div>Delete removes the selected item. Cmd/Ctrl + Enter generates the prompt. Esc cancels a connection.</div>
            </div>
          )}

          {selectedNode && (
            <>
              <div className="cp-section-head">
                <div className="cp-section-label" style={{ margin: 0 }}>Component details</div>
                <button className="cp-iconbtn" title="Delete component" onClick={deleteSelected}>×</button>
              </div>

              <div className="cp-field">
                <label className="cp-field-label">Component name</label>
                <input
                  ref={nameInputRef}
                  className="cp-input"
                  value={selectedNode.name}
                  onChange={(event) => updateNode(selectedNode.id, { name: event.target.value })}
                  onBlur={() => setRenameNodeId(null)}
                  placeholder="ComponentName"
                />
              </div>

              <div className="cp-field">
                <label className="cp-field-label">Responsibility</label>
                <textarea
                  className="cp-textarea"
                  style={{ minHeight: 78 }}
                  value={selectedNode.description || ""}
                  onChange={(event) => updateNode(selectedNode.id, { description: event.target.value })}
                  placeholder="What does this component own or render?"
                />
              </div>

              <div className="cp-section-label">Local state</div>
              {selectedNode.state.map((item) => (
                <div className="cp-row" key={item.id}>
                  <input
                    className="cp-input"
                    value={item.name}
                    placeholder="state name"
                    onChange={(event) => updateNode(selectedNode.id, {
                      state: selectedNode.state.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row),
                    })}
                  />
                  <input
                    className="cp-input"
                    value={item.type}
                    placeholder="type"
                    onChange={(event) => updateNode(selectedNode.id, {
                      state: selectedNode.state.map((row) => row.id === item.id ? { ...row, type: event.target.value } : row),
                    })}
                  />
                  <button className="cp-iconbtn" title="Remove state" onClick={() => updateNode(selectedNode.id, {
                    state: selectedNode.state.filter((row) => row.id !== item.id),
                  })}>×</button>
                </div>
              ))}
              <button className="cp-btn" style={{ width: "100%" }} onClick={() => updateNode(selectedNode.id, {
                state: [...selectedNode.state, { id: uid(), name: "", type: "" }],
              })}>+ Add state</button>
            </>
          )}

          {selectedEdge && (
            <>
              <div className="cp-section-head">
                <div className="cp-section-label" style={{ margin: 0 }}>Data flow</div>
                <button className="cp-iconbtn" title="Delete connection" onClick={deleteSelected}>×</button>
              </div>
              <div className="cp-relationship">
                {nodes.find((node) => node.id === selectedEdge.source)?.name || "Unknown"} → {nodes.find((node) => node.id === selectedEdge.target)?.name || "Unknown"}
              </div>

              <div className="cp-section-label">↓ Props passed to child</div>
              {selectedEdge.props.map((item) => (
                <div className="cp-row" key={item.id}>
                  <input
                    className="cp-input"
                    value={item.name}
                    placeholder="prop name"
                    onChange={(event) => updateEdge(selectedEdge.id, {
                      props: selectedEdge.props.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row),
                    })}
                  />
                  <input
                    className="cp-input"
                    value={item.type}
                    placeholder="type"
                    onChange={(event) => updateEdge(selectedEdge.id, {
                      props: selectedEdge.props.map((row) => row.id === item.id ? { ...row, type: event.target.value } : row),
                    })}
                  />
                  <button className="cp-iconbtn" title="Remove prop" onClick={() => updateEdge(selectedEdge.id, {
                    props: selectedEdge.props.filter((row) => row.id !== item.id),
                  })}>×</button>
                </div>
              ))}
              <button className="cp-btn" style={{ width: "100%" }} onClick={() => updateEdge(selectedEdge.id, {
                props: [...selectedEdge.props, { id: uid(), name: "", type: "" }],
              })}>+ Add prop</button>

              <div className="cp-section-label">↑ Events emitted to parent</div>
              {selectedEdge.events.map((eventItem) => (
                <div className="cp-row event" key={eventItem.id}>
                  <input
                    className="cp-input"
                    value={eventItem.name}
                    placeholder="event name"
                    onChange={(event) => updateEdge(selectedEdge.id, {
                      events: selectedEdge.events.map((row) => row.id === eventItem.id ? { ...row, name: event.target.value } : row),
                    })}
                  />
                  <input
                    className="cp-input"
                    value={eventItem.desc}
                    placeholder="what it does"
                    onChange={(event) => updateEdge(selectedEdge.id, {
                      events: selectedEdge.events.map((row) => row.id === eventItem.id ? { ...row, desc: event.target.value } : row),
                    })}
                  />
                  <button className="cp-iconbtn" title="Remove event" onClick={() => updateEdge(selectedEdge.id, {
                    events: selectedEdge.events.filter((row) => row.id !== eventItem.id),
                  })}>×</button>
                </div>
              ))}
              <button className="cp-btn" style={{ width: "100%" }} onClick={() => updateEdge(selectedEdge.id, {
                events: [...selectedEdge.events, { id: uid(), name: "", desc: "" }],
              })}>+ Add event</button>
            </>
          )}
        </aside>
      </main>

      {deletedItem && (
        <div className="cp-toast">
          <span>{deletedItem.type === "node" ? "Component deleted" : "Connection deleted"}</span>
          <button className="cp-btn compact" onClick={undoDelete}>Undo</button>
          <button className="cp-iconbtn" title="Dismiss" onClick={() => setDeletedItem(null)}>×</button>
        </div>
      )}

      {showExport && (
        <div className="cp-modal-backdrop" onPointerDown={() => setShowExport(false)}>
          <div className="cp-modal" onPointerDown={(event) => event.stopPropagation()}>
            <div className="cp-modal-head">
              <div>
                <div className="cp-modal-title">Implementation prompt</div>
                <div className="cp-modal-subtitle">
                  Built from {brief.length.toLocaleString()} requirement characters, {nodes.length} components, and {edges.length} connections
                </div>
              </div>
              <div className="cp-modal-actions">
                <button className="cp-btn" onClick={downloadPrompt}>Download .md</button>
                <button className="cp-btn primary" onClick={handleCopy}>
                  {copyStatus === "copied" ? "✓ Copied" : copyStatus === "error" ? "Copy failed" : "Copy prompt"}
                </button>
                <button className="cp-iconbtn" title="Close" onClick={() => setShowExport(false)}>×</button>
              </div>
            </div>
            <pre className="cp-prompt">{generatedPrompt}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
