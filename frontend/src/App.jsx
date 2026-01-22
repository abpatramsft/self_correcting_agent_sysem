import { useState, useRef, useEffect, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'

// Agent node definitions for workflow visualization
const WORKFLOW_NODES = {
  planner: { id: 'planner', name: 'Planner', icon: '📋', description: 'Analyzes input and creates execution plan' },
  executor: { id: 'executor', name: 'Executor', icon: '⚡', description: 'Executes the plan and generates output' },
  critic: { id: 'critic', name: 'Critic', icon: '🔍', description: 'Evaluates output quality and correctness' },
  repair: { id: 'repair', name: 'Repair', icon: '🔧', description: 'Fixes issues identified by the critic' },
  insight: { id: 'insight', name: 'InsightExplainer', icon: '💡', description: 'Explains the reasoning and insights' },
  final: { id: 'final', name: 'FinalResponder', icon: '✨', description: 'Generates the final user response' },
  orchestrator: { id: 'orchestrator', name: 'Memory Orchestrator', icon: '📝', description: 'Logs and tracks all agent outputs' },
  curator: { id: 'curator', name: 'MemoryCurator', icon: '🧠', description: 'Manages and curates run log memory' },
}

function App() {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [events, setEvents] = useState([])
  const [currentMessageText, setCurrentMessageText] = useState('')
  const [isStreamingMessage, setIsStreamingMessage] = useState(false)
  const [finalResponse, setFinalResponse] = useState('')
  const [isStreamingFinal, setIsStreamingFinal] = useState(false)
  const [currentFinalText, setCurrentFinalText] = useState('')
  const [activeNode, setActiveNode] = useState(null)
  const [completedNodes, setCompletedNodes] = useState(new Set())
  const [nodeHistory, setNodeHistory] = useState([])
  const [iteration, setIteration] = useState(0)
  const [selectedNode, setSelectedNode] = useState(null)
  const [orchestratorFlash, setOrchestratorFlash] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [logSectionOpen, setLogSectionOpen] = useState(true)
  const [expandedLogs, setExpandedLogs] = useState(new Set())
  const isFinalResponderRef = useRef(false)
  const abortControllerRef = useRef(null)
  const logContainerRef = useRef(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [events, currentMessageText])

  // Map action_id to node id
  const getNodeFromActionId = (actionId) => {
    if (!actionId) return null
    const lower = actionId.toLowerCase()
    if (lower.includes('planner')) return 'planner'
    if (lower.includes('executor')) return 'executor'
    if (lower.includes('critic')) return 'critic'
    if (lower.includes('repair')) return 'repair'
    if (lower.includes('insight') || lower.includes('explainer')) return 'insight'
    if (lower.includes('final_responder') || lower.includes('finalresponder')) return 'final'
    if (lower.includes('curator') || lower.includes('memory')) return 'curator'
    return null
  }

  // Filter events for selected node
  const filteredEvents = useMemo(() => {
    if (!selectedNode) return events
    return events.filter(event => {
      const nodeId = getNodeFromActionId(event.data?.action_id)
      return nodeId === selectedNode || event.nodeId === selectedNode
    })
  }, [events, selectedNode])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!query.trim() || isLoading) return

    // Reset state
    setEvents([])
    setCurrentMessageText('')
    setIsStreamingMessage(false)
    setFinalResponse('')
    setCurrentFinalText('')
    setIsStreamingFinal(false)
    setActiveNode(null)
    setCompletedNodes(new Set())
    setNodeHistory([])
    setIteration(0)
    setSelectedNode(null)
    setOrchestratorFlash(false)
    setInsightsOpen(false)
    setExpandedLogs(new Set())
    setLogSectionOpen(true)
    isFinalResponderRef.current = false
    setIsLoading(true)

    try {
      abortControllerRef.current = new AbortController()

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: abortControllerRef.current.signal,
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = null
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
          } else if (line.startsWith('data: ') && currentEvent) {
            const data = JSON.parse(line.slice(6))
            handleEvent(currentEvent, data)
            currentEvent = null
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        setEvents(prev => [...prev, {
          type: 'error',
          data: { message: error.message },
          timestamp: new Date()
        }])
      }
    } finally {
      setIsLoading(false)
      setActiveNode(null)
    }
  }

  const handleEvent = (eventType, data) => {
    const timestamp = new Date()
    const nodeId = getNodeFromActionId(data.action_id)

    switch (eventType) {
      case 'message_started':
        if (isFinalResponderRef.current) {
          setIsStreamingFinal(true)
          setCurrentFinalText('')
        } else {
          setIsStreamingMessage(true)
          setCurrentMessageText('')
        }
        break

      case 'text_delta':
        if (isFinalResponderRef.current) {
          setCurrentFinalText(prev => prev + data.delta)
        } else {
          setCurrentMessageText(prev => prev + data.delta)
        }
        break

      case 'text_done':
        if (isFinalResponderRef.current) {
          setFinalResponse(data.text)
          setCurrentFinalText('')
          setIsStreamingFinal(false)
        } else {
          setEvents(prev => [...prev, {
            type: 'message_content',
            data: { text: data.text },
            timestamp,
            nodeId: nodeId
          }])
          setCurrentMessageText('')
          setIsStreamingMessage(false)
        }
        break

      case 'action_started':
        if (data.action_id && data.action_id.includes('invoke_final_responder')) {
          isFinalResponderRef.current = true
        }
        
        if (data.action_id && data.action_id.includes('loop_to_critic')) {
          setIteration(prev => prev + 1)
        }

        // Flash orchestrator on log_ events
        if (data.action_id && data.action_id.startsWith('log_')) {
          setOrchestratorFlash(true)
          setTimeout(() => setOrchestratorFlash(false), 800)
        }

        const skipPrefixes = [
          'init_', 'log_', 'build_', 'guard_', 'inc_', 'update_', 'set_',
          'maybe_', 'if_', 'else_', 'check_', 'get_', 'reset_', 'clear_',
          'save_', 'load_', 'validate_', 'prepare_', 'cleanup_', 'finalize_',
          'apply_', 'loop_', 'end_', 'trigger_'
        ]
        const shouldSkipStarted = !data.action_id || 
          skipPrefixes.some(prefix => data.action_id.startsWith(prefix))
        
        if (!shouldSkipStarted && nodeId) {
          setActiveNode(nodeId)
          setNodeHistory(prev => [...prev, { nodeId, timestamp, action: 'started' }])
          setEvents(prev => [...prev, {
            type: eventType,
            data,
            timestamp,
            nodeId
          }])
        }
        break

      case 'action_completed':
        const skipPrefixesCompleted = [
          'init_', 'log_', 'build_', 'guard_', 'inc_', 'update_', 'set_',
          'maybe_', 'if_', 'else_', 'check_', 'get_', 'reset_', 'clear_',
          'save_', 'load_', 'validate_', 'prepare_', 'cleanup_', 'finalize_',
          'apply_', 'loop_', 'end_', 'trigger_'
        ]
        const shouldSkipCompleted = !data.action_id || 
          skipPrefixesCompleted.some(prefix => data.action_id.startsWith(prefix))
        
        if (!shouldSkipCompleted && nodeId) {
          setCompletedNodes(prev => new Set([...prev, nodeId]))
          setNodeHistory(prev => [...prev, { nodeId, timestamp, action: 'completed' }])
          setEvents(prev => [...prev, {
            type: eventType,
            data,
            timestamp,
            nodeId
          }])
        }
        break

      case 'response_status':
      case 'error':
        setEvents(prev => [...prev, {
          type: eventType,
          data,
          timestamp
        }])
        break

      case 'message_done':
      case 'item_added':
      case 'item_done':
      case 'content_part_added':
      case 'content_part_done':
      case 'conversation_created':
      case 'conversation_deleted':
      case 'unknown':
      case 'done':
        break

      default:
        console.log('Unhandled event:', eventType, data)
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const getNodeStatus = (nodeId) => {
    if (activeNode === nodeId) return 'active'
    if (completedNodes.has(nodeId)) return 'completed'
    return 'idle'
  }

  // Split final response into main content and process insights
  const { mainResponse, processInsights } = useMemo(() => {
    const text = finalResponse || currentFinalText
    if (!text) return { mainResponse: '', processInsights: '' }
    
    // Regex patterns to detect the explanation section
    const patterns = [
      /\n(?:#{1,3}\s*)?(?:Explanation|Process Explanation|How Was the Final Output Produced)[:\s]*.*/i,
      /\n\*\*Explanation[:\s]*.*/i,
      /\nExplanation:\s*/i,
    ]
    
    for (const pattern of patterns) {
      const match = text.search(pattern)
      if (match !== -1) {
        const mainPart = text.substring(0, match).trim()
        let insightPart = text.substring(match).trim()
        
        // Clean up the insights - remove the header variations
        insightPart = insightPart
          .replace(/^#{1,3}\s*(?:Explanation|Process Explanation|How Was the Final Output Produced)[:\s]*/i, '')
          .replace(/^\*\*Explanation[:\s]*/i, '')
          .replace(/^Explanation:\s*/i, '')
          .trim()
        
        return { mainResponse: mainPart, processInsights: insightPart }
      }
    }
    
    return { mainResponse: text, processInsights: '' }
  }, [finalResponse, currentFinalText])

  const formatEventData = (type, data) => {
    switch (type) {
      case 'action_started':
        const startedName = data.action_id
          ? data.action_id.replace('invoke_', '').replace(/_/g, ' ')
          : 'Unknown'
        return `Starting ${startedName}...`
      case 'action_completed':
        const completedName = data.action_id
          ? data.action_id.replace('invoke_', '').replace(/_/g, ' ')
          : 'Unknown'
        return `Completed ${completedName}`
      case 'message_content':
        return data.text
      case 'response_status':
        if (data.status === 'completed' && data.usage) {
          return `Completed | Tokens: ${data.usage.input_tokens} in, ${data.usage.output_tokens} out`
        }
        if (data.error) {
          return `Failed: ${data.error}`
        }
        return data.status === 'in_progress' ? 'Processing...' : data.status
      case 'error':
        return `Error: ${data.message}`
      default:
        return ''
    }
  }

  const isJsonContent = (text) => {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  const formatJsonContent = (text) => {
    try {
      const parsed = JSON.parse(text)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return text
    }
  }

  const getEventIcon = (type) => {
    const icons = {
      'action_started': '🚀',
      'action_completed': '✅',
      'message_content': '📄',
      'response_status': '📊',
      'error': '❌',
    }
    return icons[type] || '•'
  }

  const getEventClass = (type) => {
    if (type === 'message_content') return 'event-message-content'
    if (type.includes('action')) return 'event-action'
    if (type.includes('error')) return 'event-error'
    if (type.includes('response')) return 'event-response'
    return 'event-other'
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">🔄</span>
            <div className="logo-text">
              <h1>Self-Correcting Agents</h1>
              <p className="tagline">Multi-Agent Workflow Orchestration</p>
            </div>
          </div>
          {isLoading && (
            <div className="status-badge running">
              <span className="pulse-dot"></span>
              <span>Running • Iteration {iteration + 1}</span>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {/* Query Input */}
        <section className="query-section">
          <form onSubmit={handleSubmit} className="query-form">
            <div className="input-wrapper">
              <span className="input-icon">💭</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask me anything..."
                className="query-input"
                disabled={isLoading}
              />
            </div>
            <button 
              type="submit" 
              className="submit-btn"
              disabled={isLoading || !query.trim()}
            >
              {isLoading ? (
                <>
                  <span className="spinner"></span>
                  Processing
                </>
              ) : (
                <>
                  <span>Send</span>
                  <span className="btn-icon">→</span>
                </>
              )}
            </button>
            {isLoading && (
              <button 
                type="button" 
                className="stop-btn"
                onClick={handleStop}
              >
                <span>Stop</span>
              </button>
            )}
          </form>
        </section>

        {/* Workflow Visualization */}
        <section className="workflow-section">
          <div className="section-header">
            <h2>
              <span className="section-icon">🔀</span>
              Workflow Pipeline
            </h2>
            {selectedNode && (
              <button className="clear-filter-btn" onClick={() => setSelectedNode(null)}>
                Clear Filter
              </button>
            )}
          </div>
          
          <div className="workflow-container">
            <div className="workflow-diagram">
              {/* Main Pipeline - All agents in one row */}
              <div className="pipeline-track main-track">
                {['planner', 'executor'].map((nodeId, index) => {
                  const node = WORKFLOW_NODES[nodeId]
                  const status = getNodeStatus(nodeId)
                  return (
                    <div key={nodeId} className="pipeline-step">
                      <div 
                        className={`node ${status} ${selectedNode === nodeId ? 'selected' : ''}`}
                        onClick={() => setSelectedNode(selectedNode === nodeId ? null : nodeId)}
                      >
                        <div className="node-icon">{node.icon}</div>
                        <div className="node-name">{node.name}</div>
                        {status === 'active' && <div className="node-pulse"></div>}
                        {status === 'completed' && <div className="node-check">✓</div>}
                      </div>
                      <div className={`connector ${completedNodes.has(nodeId) ? 'active' : ''}`}>
                        <div className="connector-line"></div>
                        <div className="connector-arrow">▶</div>
                      </div>
                    </div>
                  )
                })}

                {/* Retry Loop Box around Critic and Repair */}
                <div className="loop-box">
                  <div className="loop-box-label">Retry Loop (max 3)</div>
                  <div className="loop-box-content">
                    {['critic', 'repair'].map((nodeId, index) => {
                      const node = WORKFLOW_NODES[nodeId]
                      const status = getNodeStatus(nodeId)
                      return (
                        <div key={nodeId} className="pipeline-step">
                          <div 
                            className={`node ${status} ${selectedNode === nodeId ? 'selected' : ''}`}
                            onClick={() => setSelectedNode(selectedNode === nodeId ? null : nodeId)}
                          >
                            <div className="node-icon">{node.icon}</div>
                            <div className="node-name">{node.name}</div>
                            {status === 'active' && <div className="node-pulse"></div>}
                            {status === 'completed' && <div className="node-check">✓</div>}
                          </div>
                          {index === 0 && (
                            <div className={`connector ${completedNodes.has(nodeId) ? 'active' : ''}`}>
                              <div className="connector-line loop-connector"></div>
                              <div className="connector-arrow">⟳</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Approved connector */}
                <div className="approved-connector">
                  <div className="connector-line approved-line"></div>
                  <div className="approved-label">Approved</div>
                  <div className="connector-arrow">▶</div>
                </div>

                {/* Final stage nodes */}
                {['insight', 'final'].map((nodeId, index) => {
                  const node = WORKFLOW_NODES[nodeId]
                  const status = getNodeStatus(nodeId)
                  return (
                    <div key={nodeId} className="pipeline-step">
                      <div 
                        className={`node ${status} ${selectedNode === nodeId ? 'selected' : ''}`}
                        onClick={() => setSelectedNode(selectedNode === nodeId ? null : nodeId)}
                      >
                        <div className="node-icon">{node.icon}</div>
                        <div className="node-name">{node.name}</div>
                        {status === 'active' && <div className="node-pulse"></div>}
                        {status === 'completed' && <div className="node-check">✓</div>}
                      </div>
                      {index === 0 && (
                        <div className={`connector ${completedNodes.has(nodeId) ? 'active' : ''}`}>
                          <div className="connector-line"></div>
                          <div className="connector-arrow">▶</div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* All Agents Log Connector */}
              <div className="log-connector">
                <div className="log-line-horizontal"></div>
                <div className="log-arrow-down">
                  <div className="log-arrow-stem"></div>
                  <div className="log-arrow-head">▼</div>
                </div>
                <div className="log-label">All agents log here</div>
              </div>

              {/* Memory Orchestrator & Curator Section */}
              <div className="memory-section">
                {/* Memory Orchestrator - Logger */}
                <div className="orchestrator-wrapper">
                  <div 
                    className={`orchestrator-node ${orchestratorFlash ? 'flash' : ''}`}
                    onClick={() => setSelectedNode(selectedNode === 'orchestrator' ? null : 'orchestrator')}
                  >
                    <div className="orchestrator-icon">📝</div>
                    <div className="orchestrator-name">Memory Orchestrator</div>
                    <div className="orchestrator-subtitle">RunLog Logger</div>
                    {orchestratorFlash && <div className="orchestrator-pulse"></div>}
                  </div>
                </div>

                {/* Dashed arrow to Memory Curator */}
                <div className="curator-arrow">
                  <div className="curator-arrow-line"></div>
                  <div className="curator-arrow-label">log overflow</div>
                  <div className="curator-arrow-head">▶</div>
                </div>

                {/* Memory Curator */}
                <div className="curator-wrapper">
                  {(() => {
                    const node = WORKFLOW_NODES.curator
                    const status = getNodeStatus('curator')
                    return (
                      <div 
                        className={`node curator-node ${status} ${selectedNode === 'curator' ? 'selected' : ''}`}
                        onClick={() => setSelectedNode(selectedNode === 'curator' ? null : 'curator')}
                      >
                        <div className="node-icon">{node.icon}</div>
                        <div className="node-name">{node.name}</div>
                        <div className="node-subtitle">Conditional</div>
                        {status === 'active' && <div className="node-pulse"></div>}
                        {status === 'completed' && <div className="node-check">✓</div>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Node Legend */}
            <div className="workflow-legend">
              <div className="legend-item">
                <div className="legend-dot idle"></div>
                <span>Idle</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot active"></div>
                <span>Active</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot completed"></div>
                <span>Completed</span>
              </div>
            </div>
          </div>
        </section>

        {/* Full-width Workflow Log */}
        <section className={`log-section ${logSectionOpen ? 'open' : 'collapsed'}`}>
          <div 
            className="section-header clickable"
            onClick={() => setLogSectionOpen(!logSectionOpen)}
          >
            <h2>
              <span className="section-icon">📋</span>
              {selectedNode ? `${WORKFLOW_NODES[selectedNode]?.name} Logs` : 'Workflow Log'}
            </h2>
            <div className="header-controls">
              <span className="event-count">{filteredEvents.length} events</span>
              <span className={`collapse-chevron ${logSectionOpen ? 'open' : ''}`}>▼</span>
            </div>
          </div>
          {logSectionOpen && (
          <div className="log-container" ref={logContainerRef}>
            {filteredEvents.length === 0 && !isLoading && !isStreamingMessage && (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>No events yet. Enter a query to start the workflow.</p>
              </div>
            )}
            {filteredEvents.map((event, index) => {
              const isLongContent = event.type === 'message_content' && event.data.text && event.data.text.length > 200
              const isExpanded = expandedLogs.has(index)
              const toggleExpand = (e) => {
                e.stopPropagation()
                setExpandedLogs(prev => {
                  const next = new Set(prev)
                  if (next.has(index)) {
                    next.delete(index)
                  } else {
                    next.add(index)
                  }
                  return next
                })
              }
              
              return (
              <div 
                key={index} 
                className={`log-entry ${getEventClass(event.type)} ${isLongContent ? 'collapsible' : ''} ${isLongContent && !isExpanded ? 'collapsed' : ''}`}
              >
                <div className="log-header" onClick={isLongContent ? toggleExpand : undefined}>
                  <span className="log-icon">{getEventIcon(event.type)}</span>
                  {event.nodeId && (
                    <span className="log-node-badge">{WORKFLOW_NODES[event.nodeId]?.name}</span>
                  )}
                  <span className="log-time">
                    {event.timestamp.toLocaleTimeString()}
                  </span>
                  {isLongContent && (
                    <span className={`log-expand-btn ${isExpanded ? 'expanded' : ''}`}>
                      {isExpanded ? '▲ Collapse' : '▼ Expand'}
                    </span>
                  )}
                </div>
                {event.type === 'message_content' ? (
                  <div className={`log-content message-json ${isLongContent && !isExpanded ? 'truncated' : ''}`}>
                    {isJsonContent(event.data.text) ? (
                      <pre className="json-block">{formatJsonContent(event.data.text)}</pre>
                    ) : (
                      <div className="text-block">{event.data.text}</div>
                    )}
                  </div>
                ) : (
                  <div className="log-content">
                    {formatEventData(event.type, event.data)}
                  </div>
                )}
              </div>
              )
            })}
            {isStreamingMessage && currentMessageText && (
              <div className="log-entry event-message-content streaming">
                <div className="log-header">
                  <span className="log-icon">📄</span>
                  {activeNode && (
                    <span className="log-node-badge">{WORKFLOW_NODES[activeNode]?.name}</span>
                  )}
                  <span className="log-time">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="log-content message-json">
                  {isJsonContent(currentMessageText) ? (
                    <pre className="json-block">{formatJsonContent(currentMessageText)}</pre>
                  ) : (
                    <div className="text-block">
                      {currentMessageText}
                      <span className="cursor">▊</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {isLoading && !isStreamingMessage && (
              <div className="log-entry event-loading">
                <span className="log-icon">⏳</span>
                <span className="log-content">Processing...</span>
              </div>
            )}
          </div>
          )}
        </section>

        {/* Final Result - Full width below logs */}
        <section className={`final-section ${finalResponse || isStreamingFinal ? 'visible' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-icon">✨</span>
              Final Response
            </h2>
          </div>
          <div className="final-container">
            {!finalResponse && !isStreamingFinal && (
              <div className="empty-state">
                <div className="empty-icon">💫</div>
                <p>The final response will appear here once the workflow completes.</p>
              </div>
            )}
            {isStreamingFinal ? (
              <div className="final-content streaming">
                <Markdown remarkPlugins={[remarkGfm]}>{currentFinalText}</Markdown>
                <span className="cursor">▊</span>
              </div>
            ) : finalResponse && (
              <>
                <div className="final-content">
                  <Markdown remarkPlugins={[remarkGfm]}>{mainResponse}</Markdown>
                </div>
                
                {/* Collapsible Process Insights */}
                {processInsights && (
                  <div className={`process-insights ${insightsOpen ? 'open' : ''}`}>
                    <button 
                      className="insights-toggle"
                      onClick={() => setInsightsOpen(!insightsOpen)}
                    >
                      <span className="insights-icon">🔬</span>
                      <span className="insights-title">Process Insights</span>
                      <span className="insights-subtitle">How was this response generated?</span>
                      <span className={`insights-chevron ${insightsOpen ? 'open' : ''}`}>▼</span>
                    </button>
                    {insightsOpen && (
                      <div className="insights-content">
                        <Markdown remarkPlugins={[remarkGfm]}>{processInsights}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Powered by Azure AI Foundry • Multi-Agent Orchestration</p>
      </footer>
    </div>
  )
}

export default App
