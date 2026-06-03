import { useState, useRef } from 'react'

export default function HelpTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLSpanElement>(null)

  function show() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.top - 8, left: r.left + r.width / 2 })
    }
    setVisible(true)
  }

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs font-bold cursor-default leading-none select-none">
        ?
      </span>

      {visible && (
        <div
          className="fixed z-[9999] w-64 pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-gray-800 text-white text-xs rounded px-3 py-2 leading-relaxed">
            {text}
          </div>
          <div className="flex justify-center">
            <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-800" />
          </div>
        </div>
      )}
    </span>
  )
}
