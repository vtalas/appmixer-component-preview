<script>
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Send,
		Bot,
		User,
		Loader2,
		Square,
		ChevronDown,
		ChevronUp,
		ChevronRight,
		Sparkles,
		Copy,
		Check,
		Wrench,
		Terminal,
		Globe,
		RefreshCw
	} from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';

	let {
		onComponentGenerated,
		context = '',
		cwd = '',
		storageKey = '',
		onDone,
		allowedTools = [],
		autoSendPrompt = '',
		onAutoSendComplete
	} = $props();

	// ── Session persistence ──────────────────────────────────────────────
	// Module-level Map keeps chat sessions alive across mount/unmount cycles.
	// Keyed by storageKey (e.g. connector name). Survives as long as the page
	// is open; lost on full page reload (intentional — Claude session IDs
	// survive server-side anyway via --session-id).
	const sessionStore = globalThis.__aiChatSessions ??= new Map();

	function saveSession() {
		if (!storageKey) return;
		sessionStore.set(storageKey, {
			messages: messages.map(m => ({ ...m })),
			sessionId,
			inputValue
		});
	}

	function restoreSession() {
		if (!storageKey) return;
		const saved = sessionStore.get(storageKey);
		if (saved) {
			messages = saved.messages;
			sessionId = saved.sessionId;
			inputValue = saved.inputValue || '';
		}
	}

	let messages = $state([]);
	let inputValue = $state('');
	let isStreaming = $state(false);
	let sessionId = $state(null);
	let abortController = null;
	let chatContainer = $state(null);
	let collapsed = $state(false);
	let copiedIndex = $state(null);

	// Terminal mode state
	// Persist mode preference per storageKey
	const modeStore = globalThis.__aiChatModeStore ??= new Map();
	let useTerminal = $state(modeStore.get(storageKey) ?? false);
	let terminalRunning = $state(false);
	let terminalAbort = null;

	$effect(() => {
		if (storageKey) modeStore.set(storageKey, useTerminal);
	});

	onMount(() => {
		restoreSession();
	});

	onDestroy(() => {
		if (terminalAbort) terminalAbort.abort();
	});

	// Auto-send prompt when set by parent (e.g. "Add Component" flow)
	$effect(() => {
		if (autoSendPrompt && !isStreaming && !terminalRunning) {
			inputValue = autoSendPrompt;
			onAutoSendComplete?.();
			setTimeout(() => sendMessage(), 0);
		}
	});

	// Debug log visible in the UI (since DevTools may not be available).
	// Toggle with the hidden ?debug query param or by clicking the header 5 times.
	let debugLog = $state([]);
	let showDebug = $state(
		typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')
	);
	function dbg(msg) {
		console.log(msg);
		debugLog = [...debugLog.slice(-50), `${new Date().toLocaleTimeString()} ${msg}`];
	}

	// Hidden activation: 5 rapid clicks on the header
	let headerClickCount = 0;
	let headerClickTimer = null;
	function onHeaderClick() {
		headerClickCount++;
		if (headerClickTimer) clearTimeout(headerClickTimer);
		headerClickTimer = setTimeout(() => { headerClickCount = 0; }, 1500);
		if (headerClickCount >= 5) {
			showDebug = !showDebug;
			headerClickCount = 0;
		}
	}

	// Auto-scroll to bottom
	function scrollToBottom() {
		if (chatContainer) {
			requestAnimationFrame(() => {
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			});
		}
	}

	// Build system prompt for Appmixer component generation
	function buildSystemContext() {
		let systemCtx = `You are an AI assistant specialized in creating Appmixer connector components.

When asked to create or modify a component, output a valid component.json JSON object.

Appmixer component.json structure:
- name: fully qualified name like "appmixer.connector.module.ComponentName"
- label: human-readable label
- description: what the component does
- auth: { service: "service_name" } if authentication is needed
- inPorts: array of input ports, each with name, schema, inspector
- outPorts: array of output ports, each with name and options/source
- properties: { inspector, schema } for component-level settings
- icon: base64 data URI for the component icon
- trigger: boolean, true if this is a trigger component
- webhook: boolean, true if webhook-based trigger
- tick: boolean, true if polling-based trigger

Inspector input types: text, textarea, number, select, multiselect, date-time, toggle, expression, key-value, filepicker

For select/multiselect with dynamic options, use source: { url: "/component/appmixer/connector/module/ComponentName?outPort=out" }

IMPORTANT: When generating a component.json, output ONLY the JSON wrapped in a markdown code block with \`\`\`json ... \`\`\`. This allows the UI to parse it and offer to apply it.`;

		if (context) {
			systemCtx += `\n\nAdditional context about the current component being edited:\n${context}`;
		}

		return systemCtx;
	}

	// Get a friendly label for a tool name
	function getToolLabel(name) {
		const labels = {
			Read: 'Read File',
			Write: 'Write File',
			Edit: 'Edit File',
			Bash: 'Run Command',
			Glob: 'Search Files',
			Grep: 'Search Code',
			Task: 'Run Agent',
			WebFetch: 'Fetch URL',
			WebSearch: 'Web Search',
			TodoWrite: 'Update Tasks',
			NotebookEdit: 'Edit Notebook',
			AskUserQuestion: 'Ask Question',
		};
		return labels[name] || name;
	}

	// Get a short summary of tool input
	function getToolInputSummary(name, input) {
		switch (name) {
			case 'Read':
				return (input.file_path) || '';
			case 'Write':
				return (input.file_path) || '';
			case 'Edit':
				return (input.file_path) || '';
			case 'Bash':
				return (input.command) || '';
			case 'Glob':
				return (input.pattern) || '';
			case 'Grep':
				return (input.pattern) || '';
			case 'Task':
				return (input.description) || (input.prompt)?.slice(0, 80) || '';
			case 'WebFetch':
				return (input.url) || '';
			case 'WebSearch':
				return (input.query) || '';
			default:
				return JSON.stringify(input).slice(0, 120);
		}
	}

	// Truncate tool result for display
	function truncateResult(text, maxLines = 20) {
		const lines = text.split('\n');
		if (lines.length <= maxLines) return text;
		return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
	}

	function toggleToolCollapse(msgIndex, toolIndex) {
		const updated = [...messages];
		const msg = updated[msgIndex];
		if (msg.toolCalls && msg.toolCalls[toolIndex]) {
			msg.toolCalls[toolIndex] = {
				...msg.toolCalls[toolIndex],
				collapsed: !msg.toolCalls[toolIndex].collapsed
			};
			messages = updated;
		}
	}

	// Helper: update tool call result immutably
	function updateToolCallResult(calls, toolUseId, result) {
		return calls.map(tc =>
			tc.id === toolUseId ? { ...tc, result: truncateResult(result, 30) } : tc
		);
	}

	// ── Shared event processing logic ────────────────────────────────────
	// Processes a single JSON event from claude --output-format stream-json
	// and mutates the running state (assistantContent, currentToolCalls).
	// Returns true when the UI should be refreshed.
	function processStreamEvent(event, state) {
		let needsUpdate = false;

		if (event.type === 'system') {
			if (event.session_id) sessionId = event.session_id;
		} else if (event.type === 'done') {
			if (event.session_id) sessionId = event.session_id;
		} else if (event.type === 'assistant') {
			const msg = event.message;
			if (msg?.content && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === 'text') {
						state.assistantContent = block.text;
						needsUpdate = true;
					} else if (block.type === 'tool_use') {
						if (!state.currentToolCalls.some(tc => tc.id === block.id)) {
							state.currentToolCalls = [...state.currentToolCalls, {
								id: block.id,
								name: block.name,
								input: (block.input) || {},
								collapsed: true
							}];
							needsUpdate = true;
						}
					}
				}
			}
			if (event.session_id) sessionId = event.session_id;
		} else if (event.type === 'content_block_delta') {
			const delta = event.delta;
			if (delta?.text) {
				state.assistantContent += delta.text;
				needsUpdate = true;
			}
		} else if (event.type === 'user') {
			const msg = event.message;
			if (msg?.content) {
				const contentItems = Array.isArray(msg.content)
					? msg.content
					: [msg.content];
				for (const item of contentItems) {
					if (item.type === 'tool_result' && item.tool_use_id) {
						let resultText = '';
						if (typeof item.content === 'string') {
							resultText = item.content;
						} else if (item.content && typeof item.content === 'object') {
							const c = item.content;
							resultText = (c.text) || JSON.stringify(c, null, 2);
						}
						if (resultText) {
							state.currentToolCalls = updateToolCallResult(
								state.currentToolCalls, item.tool_use_id, resultText
							);
							needsUpdate = true;
						}
					}
				}
			}
			// Also check tool_use_result at top level
			if (event.tool_use_result) {
				const contentItems = Array.isArray(
					event.message?.content
				)
					? (event.message.content)
					: [event.message?.content].filter(Boolean);
				for (const item of contentItems) {
					if (item.tool_use_id) {
						const existing = state.currentToolCalls.find(tc => tc.id === item.tool_use_id);
						if (existing && !existing.result) {
							const r = event.tool_use_result;
							let resultText = '';
							if (r.file && r.file.content) {
								resultText = r.file.content;
							} else if (typeof r === 'string') {
								resultText = r;
							} else if (r.text) {
								resultText = r.text;
							}
							if (resultText) {
								state.currentToolCalls = updateToolCallResult(
									state.currentToolCalls, item.tool_use_id, resultText
								);
								needsUpdate = true;
							}
						}
					}
				}
			}
		} else if (event.type === 'message') {
			if (event.role === 'assistant' && event.content) {
				if (typeof event.content === 'string') {
					state.assistantContent = event.content;
					needsUpdate = true;
				} else if (Array.isArray(event.content)) {
					for (const block of event.content) {
						if (block.type === 'text') {
							state.assistantContent = block.text;
							needsUpdate = true;
						} else if (block.type === 'tool_use') {
							if (!state.currentToolCalls.some(tc => tc.id === block.id)) {
								state.currentToolCalls = [...state.currentToolCalls, {
									id: block.id,
									name: block.name,
									input: (block.input) || {},
									collapsed: true
								}];
								needsUpdate = true;
							}
						}
					}
				}
			}
			if (event.session_id) sessionId = event.session_id;
		} else if (event.type === 'result') {
			if (event.result && !state.assistantContent) {
				state.assistantContent = event.result;
				needsUpdate = true;
			}
			if (event.session_id) sessionId = event.session_id;
		} else if (event.type === 'error') {
			state.assistantContent += (state.assistantContent ? '\n\n' : '') +
				`Error: ${(event.message) || 'Unknown error'}`;
			needsUpdate = true;
		}

		return needsUpdate;
	}

	// Push the current stream state into the messages array
	function flushStreamState(state) {
		const updated = [...messages];
		updated[updated.length - 1] = {
			role: 'assistant',
			content: state.assistantContent,
			timestamp: updated[updated.length - 1].timestamp,
			toolCalls: state.currentToolCalls.map(tc => ({ ...tc }))
		};
		messages = updated;
		scrollToBottom();
	}

	// ── Send to Terminal ─────────────────────────────────────────────────
	async function sendToTerminal() {
		const text = inputValue.trim();
		if (!text || isStreaming || terminalRunning) return;

		inputValue = '';

		messages = [...messages, {
			role: 'user',
			content: text,
			timestamp: new Date()
		}];

		// Add placeholder assistant message
		messages = [...messages, {
			role: 'assistant',
			content: '',
			timestamp: new Date(),
			toolCalls: [],
			isTerminal: true
		}];

		scrollToBottom();
		terminalRunning = true;

		const systemContext = buildSystemContext();
		const fullPrompt = sessionId
			? text
			: `${systemContext}\n\n---\n\nUser request: ${text}`;

		const state = {
			assistantContent: '',
			currentToolCalls: []
		};

		try {
			// Launch Terminal.app with claude
			const launchRes = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: fullPrompt,
					sessionId,
					cwd: cwd || undefined,
					context: sessionId ? undefined : systemContext
				})
			});

			if (!launchRes.ok) {
				const data = await launchRes.json();
				throw new Error(data.error || 'Failed to open terminal');
			}

			const { sessionId: sid, logFile } = await launchRes.json();
			if (sid) sessionId = sid;

			// Update the assistant message to show terminal status
			const updated = [...messages];
			updated[updated.length - 1] = {
				...updated[updated.length - 1],
				content: '_Running in Terminal.app — output will appear here as Claude works..._'
			};
			messages = updated;
			scrollToBottom();

			// Stream the terminal output via SSE
			const controller = new AbortController();
			terminalAbort = controller;

			const outputRes = await fetch(`/api/terminal?sessionId=${encodeURIComponent(sid)}`, {
				signal: controller.signal
			});

			if (outputRes.ok && outputRes.body) {
				const reader = outputRes.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const jsonStr = line.slice(6);
						try {
							const event = JSON.parse(jsonStr);
							if (event.type === 'terminal_done') {
								// Terminal session finished
								break;
							}
							if (processStreamEvent(event, state)) {
								flushStreamState(state);
							}
						} catch {
							// skip unparseable
						}
					}
				}
			}

			// Check for component JSON in the output
			const componentJson = extractComponentJson(state.assistantContent);
			if (componentJson) {
				const final = [...messages];
				final[final.length - 1] = {
					...final[final.length - 1],
					componentJson
				};
				messages = final;
			}
		} catch (err) {
			if (err instanceof Error && err.name !== 'AbortError') {
				const updated = [...messages];
				updated[updated.length - 1] = {
					...updated[updated.length - 1],
					content: `Error: ${err.message}`
				};
				messages = updated;
			}
		} finally {
			terminalRunning = false;
			terminalAbort = null;
			saveSession();
			onDone?.();
			scrollToBottom();
		}
	}

	// ── Send message (web mode) ─────────────────────────────────────────
	async function sendMessage() {
		if (useTerminal) {
			return sendToTerminal();
		}

		const text = inputValue.trim();
		if (!text || isStreaming) return;

		inputValue = '';

		// Add user message
		messages = [...messages, {
			role: 'user',
			content: text,
			timestamp: new Date()
		}];

		scrollToBottom();
		isStreaming = true;

		// Build the full prompt with system context for first message
		const systemContext = buildSystemContext();
		const fullPrompt = sessionId
			? text
			: `${systemContext}\n\n---\n\nUser request: ${text}`;

		// Add placeholder assistant message
		messages = [...messages, {
			role: 'assistant',
			content: '',
			timestamp: new Date(),
			toolCalls: []
		}];

		const state = {
			assistantContent: '',
			currentToolCalls: []
		};

		// SSE via /api/chat endpoint (Node.js backend spawns claude CLI)
		const controller = new AbortController();
		abortController = controller;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: fullPrompt,
					sessionId,
					...(cwd ? { cwd } : {}),
					...(allowedTools.length > 0 ? { allowedTools } : {})
				}),
				signal: controller.signal
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process SSE lines
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const jsonStr = line.slice(6);
					try {
						const event = JSON.parse(jsonStr);
						if (processStreamEvent(event, state)) {
							flushStreamState(state);
						}
					} catch {
						// skip unparseable lines
					}
				}
			}

			// Check if the response contains a component.json
			const componentJson = extractComponentJson(state.assistantContent);
			if (componentJson) {
				const updated = [...messages];
				updated[updated.length - 1] = {
					...updated[updated.length - 1],
					componentJson
				};
				messages = updated;
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				const updated = [...messages];
				if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
					updated[updated.length - 1] = {
						...updated[updated.length - 1],
						content: updated[updated.length - 1].content + '\n\n_(cancelled)_'
					};
					messages = updated;
				}
			} else {
				messages = [...messages.slice(0, -1), {
					role: 'assistant',
					content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
					timestamp: new Date()
				}];
			}
		} finally {
			isStreaming = false;
			abortController = null;
			scrollToBottom();
			saveSession();
			onDone?.();
		}
	}

	function stopStreaming() {
		if (abortController) {
			abortController.abort();
		}
	}

	// Extract JSON from markdown code blocks
	function extractComponentJson(text) {
		const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1]);
				// Basic validation: check if it looks like a component.json
				if (parsed && (parsed.name || parsed.inPorts || parsed.outPorts || parsed.properties)) {
					return parsed;
				}
			} catch {
				// Invalid JSON
			}
		}
		return null;
	}

	function applyComponent(componentJson) {
		if (onComponentGenerated) {
			onComponentGenerated(componentJson);
		}
	}

	function copyToClipboard(text, index) {
		navigator.clipboard.writeText(text);
		copiedIndex = index;
		setTimeout(() => {
			copiedIndex = null;
		}, 2000);
	}

	function handleKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	// Simple markdown-ish rendering for code blocks
	function formatContent(content) {
		// Escape HTML
		let html = content
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		// Code blocks
		html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, '<pre class="code-block"><code>$2</code></pre>');

		// Inline code
		html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

		// Bold
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

		// Italic
		html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

		// Line breaks
		html = html.replace(/\n/g, '<br>');

		return html;
	}
</script>

<div class="ai-chat-panel {collapsed ? 'collapsed' : ''}">
	<div class="chat-header-row">
		<button class="chat-header" onclick={() => { collapsed = !collapsed; onHeaderClick(); }}>
			<div class="chat-header-left">
				<Sparkles class="h-4 w-4" />
				<span class="chat-title">AI Assistant</span>
				{#if sessionId}
					<Badge variant="outline" class="session-badge">Session active</Badge>
				{/if}
				{#if terminalRunning}
					<Badge variant="secondary" class="terminal-badge">
						<Terminal class="h-3 w-3" />
						Terminal
					</Badge>
				{/if}
			</div>
			<div class="chat-header-right">
				{#if isStreaming || terminalRunning}
					<Loader2 class="h-4 w-4 spinning" />
				{/if}
				{#if collapsed}
					<ChevronUp class="h-4 w-4" />
				{:else}
					<ChevronDown class="h-4 w-4" />
				{/if}
			</div>
		</button>
		{#if !collapsed}
			<div class="mode-toggle">
				<button
					class="mode-btn {!useTerminal ? 'active' : ''}"
					onclick={() => useTerminal = false}
					title="Web mode — runs in background"
				>
					<Globe class="h-3.5 w-3.5" />
				</button>
				<button
					class="mode-btn {useTerminal ? 'active' : ''}"
					onclick={() => useTerminal = true}
					title="Terminal mode — opens Terminal.app for interactive use"
				>
					<Terminal class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}
	</div>

	{#if !collapsed}
		<div class="chat-body">
			<div class="chat-messages" bind:this={chatContainer}>
				{#if messages.length === 0}
					<div class="chat-empty">
						<Sparkles class="h-8 w-8 empty-icon" />
						<p class="empty-title">AI Component Assistant</p>
						<p class="empty-desc">Ask me to generate or modify Appmixer components. For example:</p>
						<div class="suggestions">
							<button class="suggestion" onclick={() => { inputValue = 'Create an Airtable ListBases component that lists all bases accessible by the user'; }}>
								Create an Airtable ListBases component
							</button>
							<button class="suggestion" onclick={() => { inputValue = 'Generate a Slack SendMessage action component with channel and message text inputs'; }}>
								Generate a Slack SendMessage component
							</button>
							<button class="suggestion" onclick={() => { inputValue = 'Create a webhook trigger component for receiving GitHub push events'; }}>
								Create a GitHub webhook trigger
							</button>
						</div>
					</div>
				{:else}
					{#each messages as msg, i}
						<div class="chat-message {msg.role}">
							<div class="message-avatar">
								{#if msg.role === 'user'}
									<User class="h-4 w-4" />
								{:else}
									<Bot class="h-4 w-4" />
								{/if}
							</div>
							<div class="message-body">
								<!-- Tool calls section -->
								{#if msg.toolCalls && msg.toolCalls.length > 0}
									<div class="tool-calls-section">
										{#each msg.toolCalls as tool, ti}
											<div class="tool-call">
												<button
													class="tool-call-header"
													onclick={() => toggleToolCollapse(i, ti)}
												>
													<div class="tool-call-left">
														<ChevronRight class="h-3 w-3 tool-chevron {tool.collapsed ? '' : 'expanded'}" />
														<Wrench class="h-3 w-3 tool-icon" />
														<span class="tool-name">{getToolLabel(tool.name)}</span>
														<span class="tool-summary">{getToolInputSummary(tool.name, tool.input)}</span>
													</div>
													{#if tool.result}
														<Check class="h-3 w-3 tool-done-icon" />
													{:else if isStreaming}
														<Loader2 class="h-3 w-3 spinning tool-pending-icon" />
													{/if}
												</button>
												{#if !tool.collapsed}
													<div class="tool-call-detail">
														{#if tool.input && Object.keys(tool.input).length > 0}
															<div class="tool-detail-section">
																<div class="tool-detail-label">Input</div>
																<pre class="tool-detail-content">{JSON.stringify(tool.input, null, 2)}</pre>
															</div>
														{/if}
														{#if tool.result}
															<div class="tool-detail-section">
																<div class="tool-detail-label">Result</div>
																<pre class="tool-detail-content">{tool.result}</pre>
															</div>
														{/if}
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}

								<!-- Text content -->
								{#if msg.content}
									<div class="message-content">
										{@html formatContent(msg.content)}
									</div>
								{/if}
								{#if msg.componentJson}
									<div class="component-actions">
										<Button
											variant="default"
											size="sm"
											onclick={() => applyComponent(msg.componentJson)}
										>
											<Sparkles class="h-3.5 w-3.5 mr-1" />
											Apply Component
										</Button>
										<Button
											variant="outline"
											size="sm"
											onclick={() => copyToClipboard(JSON.stringify(msg.componentJson, null, 2), i)}
										>
											{#if copiedIndex === i}
												<Check class="h-3.5 w-3.5 mr-1" />
												Copied
											{:else}
												<Copy class="h-3.5 w-3.5 mr-1" />
												Copy JSON
											{/if}
										</Button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
					{#if isStreaming || terminalRunning}
						{@const lastMsg = messages[messages.length - 1]}
						{@const hasContent = lastMsg && (lastMsg.content || (lastMsg.toolCalls && lastMsg.toolCalls.length > 0))}
						<div class="streaming-indicator">
							<Loader2 class="h-3.5 w-3.5 spinning" />
							{#if terminalRunning}
								<span>Running in Terminal{hasContent ? ' — streaming output...' : '...'}</span>
							{:else}
								<span>{hasContent ? 'Claude is working...' : 'Claude is thinking...'}</span>
							{/if}
						</div>
					{/if}
				{/if}
				<!-- Debug log (hidden by default; enable with ?debug or 5× header click) -->
				{#if showDebug && debugLog.length > 0}
					<details class="debug-log">
						<summary>Debug log ({debugLog.length})</summary>
						<pre>{debugLog.join('\n')}</pre>
					</details>
				{/if}
			</div>

			<div class="chat-input-area">
				<textarea
					class="chat-input"
					placeholder={useTerminal ? "Type your prompt — will open in Terminal.app..." : "Describe the component you want to create..."}
					bind:value={inputValue}
					onkeydown={handleKeydown}
					rows="2"
					disabled={isStreaming || terminalRunning}
				></textarea>
				<div class="chat-input-actions">
					{#if isStreaming}
						<Button variant="destructive" size="sm" onclick={stopStreaming}>
							<Square class="h-3.5 w-3.5 mr-1" />
							Stop
						</Button>
					{:else if terminalRunning}
						<Button variant="outline" size="sm" onclick={() => onDone?.()}>
							<RefreshCw class="h-3.5 w-3.5 mr-1" />
							Refresh Tree
						</Button>
					{:else}
						<Button
							variant="default"
							size="sm"
							onclick={sendMessage}
							disabled={!inputValue.trim()}
						>
							{#if useTerminal}
								<Terminal class="h-3.5 w-3.5 mr-1" />
								Send to Terminal
							{:else}
								<Send class="h-3.5 w-3.5 mr-1" />
								Send
							{/if}
						</Button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.ai-chat-panel {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		overflow: hidden;
		max-height: 80vh;
	}

	.ai-chat-panel.collapsed {
		max-height: none;
	}

	.chat-header-row {
		display: flex;
		align-items: center;
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		border: none;
		background: transparent;
		cursor: pointer;
		flex: 1;
		text-align: left;
	}

	.chat-header:hover {
		background: var(--color-accent);
	}

	.mode-toggle {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0 10px;
		border-left: 1px solid var(--color-border);
	}

	.mode-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: var(--radius-sm);
		color: var(--color-muted-foreground);
		transition: all 0.15s ease;
	}

	.mode-btn:hover {
		background: var(--color-accent);
		color: var(--color-foreground);
	}

	.mode-btn.active {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	:global(.terminal-badge) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
	}

	.chat-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.chat-title {
		font-size: 13px;
		font-weight: 600;
	}

	:global(.session-badge) {
		font-size: 10px;
	}

	.chat-header-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.chat-body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 200px;
		max-height: 60vh;
	}

	.chat-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
		text-align: center;
		color: var(--color-muted-foreground);
		flex: 1;
	}

	:global(.empty-icon) {
		opacity: 0.4;
		margin-bottom: 8px;
	}

	.empty-title {
		font-size: 14px;
		font-weight: 500;
		margin: 0 0 4px;
		color: var(--color-foreground);
	}

	.empty-desc {
		font-size: 12px;
		margin: 0 0 16px;
	}

	.suggestions {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
	}

	.suggestion {
		padding: 8px 12px;
		background: var(--color-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: 12px;
		text-align: left;
		color: var(--color-foreground);
		transition: all 0.15s ease;
	}

	.suggestion:hover {
		background: var(--color-accent);
		border-color: var(--color-ring);
	}

	.chat-message {
		display: flex;
		gap: 10px;
	}

	.message-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: var(--color-muted);
		color: var(--color-muted-foreground);
	}

	.chat-message.assistant .message-avatar {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	.message-body {
		flex: 1;
		min-width: 0;
	}

	.message-content {
		font-size: 13px;
		line-height: 1.5;
		word-break: break-word;
	}

	:global(.code-block) {
		background: var(--color-muted);
		padding: 12px;
		border-radius: var(--radius-md);
		overflow-x: auto;
		font-size: 11px;
		margin: 8px 0;
		font-family: monospace;
		white-space: pre;
	}

	:global(.inline-code) {
		background: var(--color-muted);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		font-family: monospace;
	}

	.component-actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}

	/* Tool calls styling */
	.tool-calls-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}

	.tool-call {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-muted);
	}

	.tool-call-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 10px;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 12px;
		color: var(--color-foreground);
		text-align: left;
		gap: 6px;
	}

	.tool-call-header:hover {
		background: var(--color-accent);
	}

	.tool-call-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	:global(.tool-chevron) {
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}

	:global(.tool-chevron.expanded) {
		transform: rotate(90deg);
	}

	:global(.tool-icon) {
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}

	.tool-name {
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.tool-summary {
		color: var(--color-muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	:global(.tool-done-icon) {
		flex-shrink: 0;
		color: #22c55e;
	}

	:global(.tool-pending-icon) {
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}

	.tool-call-detail {
		border-top: 1px solid var(--color-border);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.tool-detail-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tool-detail-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
	}

	.tool-detail-content {
		font-size: 11px;
		font-family: monospace;
		background: var(--color-background);
		padding: 8px;
		border-radius: var(--radius-sm);
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
		max-height: 200px;
		overflow-y: auto;
	}

	.streaming-indicator {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--color-muted-foreground);
		padding: 4px 0;
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.chat-input-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--color-border);
		background: var(--color-background);
	}

	.chat-input {
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 8px 12px;
		font-size: 13px;
		font-family: inherit;
		resize: none;
		background: var(--color-card);
		color: var(--color-foreground);
		outline: none;
	}

	.chat-input:focus {
		border-color: var(--color-ring);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-ring) 20%, transparent);
	}

	.chat-input:disabled {
		opacity: 0.6;
	}

	.chat-input-actions {
		display: flex;
		justify-content: flex-end;
	}

	.debug-log {
		margin-top: 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: #1a1a2e;
		font-size: 10px;
		color: #8888aa;
	}

	.debug-log summary {
		padding: 4px 8px;
		cursor: pointer;
		user-select: none;
	}

	.debug-log pre {
		padding: 6px 8px;
		margin: 0;
		max-height: 200px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
		font-family: monospace;
		font-size: 10px;
		line-height: 1.4;
	}
</style>
