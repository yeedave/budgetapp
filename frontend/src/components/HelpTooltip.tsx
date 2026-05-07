export default function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span className="flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs font-bold cursor-default leading-none select-none">
        ?
      </span>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <div className="bg-gray-800 text-white text-xs rounded px-3 py-2 leading-relaxed">
          {text}
        </div>
        <div className="flex justify-center">
          <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-800" />
        </div>
      </div>
    </span>
  )
}
