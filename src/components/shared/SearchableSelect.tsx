import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, X, Plus } from 'lucide-react'

export interface SearchableOption {
  value: string
  label: string
  sublabel?: string
}

interface SearchableSelectProps {
  options: SearchableOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
  onAddNew?: () => void
  addNewLabel?: string
  required?: boolean
  autoFocusSearch?: boolean
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  className = '',
  disabled = false,
  allowClear = false,
  onAddNew,
  addNewLabel = 'Add New',
  autoFocusSearch = true,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return options.find(opt => opt.value === value)
  }, [options, value])

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return options
    return options.filter(opt => {
      const labelMatch = opt.label.toLowerCase().includes(q)
      const sublabelMatch = opt.sublabel?.toLowerCase().includes(q)
      return labelMatch || sublabelMatch
    })
  }, [options, searchTerm])

  // Reset highlight when filtered options change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredOptions])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      if (autoFocusSearch) {
        // slight timeout ensures DOM node is rendered
        const timer = setTimeout(() => {
          searchInputRef.current?.focus()
        }, 50)
        return () => clearTimeout(timer)
      }
    } else {
      setSearchTerm('')
    }
  }, [isOpen, autoFocusSearch])

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, isOpen])

  // Click outside detection: only close when clicking strictly outside containerRef
  // Note: We deliberately do NOT listen to 'blur' or 'visibilitychange' so taking screenshots
  // (e.g. Win+Shift+S / Snipping Tool) does NOT dismiss this dropdown!
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [isOpen])

  const handleSelect = (val: string) => {
    onChange(val)
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => (prev < filteredOptions.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredOptions[highlightedIndex]) {
        handleSelect(filteredOptions[highlightedIndex].value)
      } else if (onAddNew && searchTerm.trim()) {
        onAddNew()
        setIsOpen(false)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'Tab') {
      setIsOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        className={`input flex items-center justify-between gap-2 w-full text-left cursor-pointer transition-colors select-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${isOpen ? 'ring-2 ring-brand-500/40 border-brand-500' : ''}`}
      >
        <span
          className={`truncate text-sm flex-1 ${
            selectedOption ? 'text-slate-100 font-medium' : 'text-slate-400'
          }`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>

        <div className="flex items-center gap-1 flex-shrink-0 text-slate-400">
          {allowClear && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-slate-700 hover:text-slate-200 transition-colors cursor-pointer"
              title="Clear selection"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-brand-400' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown Popup Menu */}
      {isOpen && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl shadow-2xl border flex flex-col animate-in fade-in zoom-in-95 duration-100"
          style={{
            background: 'var(--bg-card, #0f172a)',
            borderColor: 'var(--border, #334155)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
            minWidth: '260px',
          }}
        >
          {/* Sticky Search Header */}
          <div
            className="p-2.5 border-b sticky top-0 z-10 flex items-center gap-2"
            style={{
              background: 'var(--bg-card, #0f172a)',
              borderColor: 'var(--border, #1e293b)',
            }}
          >
            <Search size={14} className="text-slate-400 ml-1 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none w-full flex-1"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
                title="Clear search"
              >
                <X size={12} />
              </button>
            ) : (
              <span className="text-[11px] font-mono text-slate-500 px-1">
                {filteredOptions.length}
              </span>
            )}
          </div>

          {/* Options List */}
          <div
            ref={listRef}
            className="max-h-60 overflow-y-auto p-1.5 space-y-0.5 divide-y divide-slate-800/20"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-6 px-3 text-center">
                <p className="text-xs text-slate-400">
                  No matching results found for{' '}
                  <span className="text-amber-400 font-medium">"{searchTerm}"</span>
                </p>
                {onAddNew && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddNew()
                      setIsOpen(false)
                    }}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white transition-all shadow-sm"
                  >
                    <Plus size={13} />
                    <span>{addNewLabel} "{searchTerm}"</span>
                  </button>
                )}
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value
                const isHighlighted = idx === highlightedIndex

                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`px-3 py-2 rounded-lg text-sm cursor-pointer transition-all flex items-center justify-between gap-2 select-none ${
                      isSelected
                        ? 'bg-brand-500/15 text-brand-300 font-semibold border border-brand-500/30'
                        : isHighlighted
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-xs sm:text-sm">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {opt.sublabel}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <Check size={14} className="text-brand-400 flex-shrink-0" />
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Optional Footer Shortcut */}
          {onAddNew && (
            <div
              className="p-2 border-t flex items-center justify-between text-xs"
              style={{
                borderColor: 'var(--border, #1e293b)',
                background: 'rgba(15, 23, 42, 0.5)',
              }}
            >
              <span className="text-[11px] text-slate-500">
                {options.length} categories available
              </span>
              <button
                type="button"
                onClick={() => {
                  onAddNew()
                  setIsOpen(false)
                }}
                className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
              >
                <Plus size={13} />
                <span>{addNewLabel}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
