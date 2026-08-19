import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

interface YTextAreaProps {
  ytext: Y.Text
  className?: string
  placeholder?: string
  rows?: number
}

export function YTextArea({ ytext, className, placeholder, rows }: YTextAreaProps) {
  const [value, setValue] = useState<string>(() => ytext.toString())
  const isTyping = useRef(false)

  useEffect(() => {
    const observer = () => {
      if (isTyping.current) return
      setValue(ytext.toString())
    }
    ytext.observe(observer)
    return () => ytext.unobserve(observer)
  }, [ytext])

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value
    const oldValue = ytext.toString()
    setValue(newValue)
    if (newValue === oldValue) return

    isTyping.current = true
    try {
      let start = 0
      while (
        start < oldValue.length &&
        start < newValue.length &&
        oldValue[start] === newValue[start]
      ) {
        start++
      }

      let end = 0
      while (
        end < oldValue.length - start &&
        end < newValue.length - start &&
        oldValue[oldValue.length - 1 - end] === newValue[newValue.length - 1 - end]
      ) {
        end++
      }

      ytext.delete(start, oldValue.length - start - end)
      ytext.insert(start, newValue.slice(start, newValue.length - end))
    } finally {
      isTyping.current = false
    }
  }

  return (
    <textarea
      className={className}
      placeholder={placeholder}
      rows={rows}
      value={value}
      onChange={handleChange}
    />
  )
}