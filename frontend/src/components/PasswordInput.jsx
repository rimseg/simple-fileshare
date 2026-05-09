import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from './Icons.jsx';

export default function PasswordInput({ value, onChange, autoFocus, minLength, required, placeholder, id }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        minLength={minLength}
        required={required}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((v) => !v)}
        tabIndex={-1}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
