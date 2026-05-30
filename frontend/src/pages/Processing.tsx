/**
 * Processing status page component.
 * Phase 1: Placeholder.
 * Phase 3: Live pipeline status with WebSocket.
 */

export default function Processing() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-primary mb-4">Processing Pipeline</h1>
      
      <div className="bg-white rounded-xl p-12 text-center">
        <div className="text-6xl mb-4">⚙️</div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">
          Pipeline Status Coming in Phase 3
        </h2>
        <p className="text-on-surface-variant">
          Live extraction pipeline status: Parse → Extract → Ground → Validate
        </p>
      </div>
    </div>
  );
}
