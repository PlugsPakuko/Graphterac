import React from 'react'

export default function Button({ children, variant = 'default', className = '', ...props }) {
  const base = 'btn'
  const varClass = variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : ''
  return (
    <button className={`${base} ${varClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}
