'use client'

import { useRef, useMemo, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { GraphData, GraphNode, GraphEdge } from '@/lib/graph/types'
import { NODE_COLORS, EDGE_COLORS } from '@/lib/graph/types'

// ── Node sphere ───────────────────────────────────────────────────────────────

function NodeMesh({
  node,
  selected,
  dimmed,
  onClick,
}: {
  node:     GraphNode
  selected: boolean
  dimmed:   boolean
  onClick:  (n: GraphNode) => void
}) {
  const meshRef     = useRef<THREE.Mesh>(null)
  const color       = NODE_COLORS[node.type] ?? '#6b7280'
  const baseSize    = 0.8 + node.pageRank * 1.6 + Math.min(node.connections, 8) * 0.15
  const emissiveInt = selected ? 1.2 : dimmed ? 0.05 : 0.4

  useFrame((_, delta) => {
    if (!meshRef.current) return
    // Gentle pulse when selected
    if (selected) {
      const t = Date.now() * 0.003
      meshRef.current.scale.setScalar(1 + Math.sin(t) * 0.08)
    } else {
      meshRef.current.scale.setScalar(1)
    }
    // Slow idle rotation on y
    meshRef.current.rotation.y += delta * 0.3
  })

  return (
    <group position={[node.position3d.x, node.position3d.y, node.position3d.z]}>
      <mesh
        ref={meshRef}
        onClick={e => { e.stopPropagation(); onClick(node) }}
      >
        <sphereGeometry args={[baseSize, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveInt}
          roughness={0.3}
          metalness={0.4}
          transparent
          opacity={dimmed ? 0.25 : 1}
        />
      </mesh>

      {/* Label — only when not dimmed */}
      {!dimmed && (
        <Text
          position={[0, baseSize + 0.6, 0]}
          fontSize={0.9}
          color={selected ? '#ffffff' : '#9090b0'}
          anchorX="center"
          anchorY="bottom"
          maxWidth={12}
          overflowWrap="break-word"
        >
          {node.label}
        </Text>
      )}
    </group>
  )
}

// ── Edge line ─────────────────────────────────────────────────────────────────

function EdgeLine({
  edge,
  sourcePos,
  targetPos,
  dimmed,
}: {
  edge:      GraphEdge
  sourcePos: THREE.Vector3
  targetPos: THREE.Vector3
  dimmed:    boolean
}) {
  const color   = EDGE_COLORS[edge.relation] ?? '#4b5563'
  const opacity = dimmed ? 0.04 : edge.weight * 0.5

  return (
    <Line
      points={[sourcePos, targetPos]}
      color={color}
      lineWidth={dimmed ? 0.3 : 0.8}
      transparent
      opacity={opacity}
    />
  )
}

// ── Camera auto-fit ───────────────────────────────────────────────────────────

function CameraFit({ nodes }: { nodes: GraphNode[] }) {
  const { camera } = useThree()
  const fitted = useRef(false)

  useFrame(() => {
    if (fitted.current || nodes.length === 0) return
    fitted.current = true
    // Find bounding sphere
    const positions = nodes.map(n =>
      new THREE.Vector3(n.position3d.x, n.position3d.y, n.position3d.z),
    )
    const box = new THREE.Box3().setFromPoints(positions)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const size = box.getSize(new THREE.Vector3()).length()
    camera.position.set(center.x, center.y + size * 0.3, center.z + size * 0.9)
    camera.lookAt(center)
  })

  return null
}

// ── Main scene ────────────────────────────────────────────────────────────────

function Scene({
  data,
  selectedId,
  filteredTypes,
  searchQuery,
  onNodeClick,
}: {
  data:          GraphData
  selectedId:    string | null
  filteredTypes: Set<string>
  searchQuery:   string
  onNodeClick:   (n: GraphNode) => void
}) {
  // Build position map for edges
  const posMap = useMemo(() => {
    const m = new Map<string, THREE.Vector3>()
    for (const n of data.nodes) {
      m.set(n.id, new THREE.Vector3(n.position3d.x, n.position3d.y, n.position3d.z))
    }
    return m
  }, [data])

  const visibleNodes = useMemo(() =>
    data.nodes.filter(n => filteredTypes.size === 0 || filteredTypes.has(n.type)),
    [data.nodes, filteredTypes],
  )

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  const visibleEdges = useMemo(() =>
    data.edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [data.edges, visibleNodeIds],
  )

  // Highlight matching nodes for search
  const matchingIds = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q   = searchQuery.toLowerCase()
    const ids = new Set<string>()
    for (const n of visibleNodes) {
      if (n.label.toLowerCase().includes(q) || n.type.includes(q)) ids.add(n.id)
    }
    return ids
  }, [visibleNodes, searchQuery])

  const isDimmed = useCallback((id: string) => {
    if (selectedId && id !== selectedId) {
      // Show selected + its neighbours
      const neighbourIds = new Set<string>()
      for (const e of data.edges) {
        if (e.source === selectedId) neighbourIds.add(e.target)
        if (e.target === selectedId) neighbourIds.add(e.source)
      }
      return !neighbourIds.has(id)
    }
    if (matchingIds && !matchingIds.has(id)) return true
    return false
  }, [selectedId, matchingIds, data.edges])

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[100, 100, 100]} intensity={1.2} />
      <pointLight position={[-100, -100, -100]} intensity={0.6} color="#6c63ff" />

      <CameraFit nodes={visibleNodes} />
      <OrbitControls enablePan enableZoom enableRotate dampingFactor={0.1} />

      {/* Edges */}
      {visibleEdges.map(edge => {
        const sp = posMap.get(edge.source)
        const tp = posMap.get(edge.target)
        if (!sp || !tp) return null
        const dim = isDimmed(edge.source) || isDimmed(edge.target)
        return (
          <EdgeLine
            key={edge.id}
            edge={edge}
            sourcePos={sp}
            targetPos={tp}
            dimmed={dim}
          />
        )
      })}

      {/* Nodes */}
      {visibleNodes.map(node => (
        <NodeMesh
          key={node.id}
          node={node}
          selected={node.id === selectedId}
          dimmed={isDimmed(node.id)}
          onClick={onNodeClick}
        />
      ))}
    </>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface GraphSceneProps {
  data:          GraphData
  selectedId:    string | null
  filteredTypes: Set<string>
  searchQuery:   string
  onNodeClick:   (n: GraphNode) => void
}

export default function GraphScene(props: GraphSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 200], fov: 60, near: 0.1, far: 10000 }}
      style={{ background: '#050508' }}
      gl={{ antialias: true, alpha: false }}
    >
      <Scene {...props} />
    </Canvas>
  )
}
