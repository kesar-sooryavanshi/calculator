/**
 * index.js — Premium Calculator
 *
 * Architecture:
 *   CalcEngine  → pure logic, no DOM deps
 *   CalcHistory → manages & persists history (localStorage)
 *   CalcUI      → DOM bindings, animations, display
 *
 * All three are coordinated by the init() factory at the bottom.
 */

'use strict';

// ================================================================
// 1. CALC ENGINE — Pure calculation logic (zero DOM dependencies)
// ================================================================

class CalcEngine {
  constructor() {
    this._reset();
  }

  /** Returns a plain snapshot of internal state (for UI to consume). */
  get state() {
    return {
      current:   this._current,
      previous:  this._previous,
      operation: this._op,
      error:     this._error,
    };
  }

  // ── Public API ────────────────────────────────────────────────

  /** Append a digit or decimal point. */
  inputDigit(char) {
    if (this._error) this._reset();

    const c = this._current;

    // One decimal per operand
    if (char === '.' && c.includes('.')) return;
    // Auto-prefix '0' before decimal
    if (char === '.' && (c === '' || c === '-')) { this._current += '0'; }
    // Prevent leading zero duplication
    if (char === '0' && c === '0') return;
    // Replace bare '0' with digit (not decimal)
    if (char !== '.' && c === '0') { this._current = char; return; }

    this._current += char;
  }

  /** Select an operator (+, −, ×, ÷). Handles chaining. */
  inputOperator(op) {
    if (this._error) this._reset();

    // Allow unary minus as first entry
    if (op === '-' && this._current === '' && this._previous === '') {
      this._current = '-';
      return;
    }

    // Change operator without a new operand
    if (this._current === '' && this._previous !== '') {
      this._op = op;
      return;
    }

    // Nothing to work with
    if (this._current === '' || this._current === '-') return;

    // Continuous calculation (e.g. 2 + 3 × …)
    if (this._previous !== '') {
      this._evaluate();
      if (this._error) return;
    }

    this._op       = op;
    this._previous = this._current;
    this._current  = '';
  }

  /** Convert current operand to percentage. */
  inputPercent() {
    if (this._error || this._current === '' || this._current === '-') return;
    const n = parseFloat(this._current);
    if (isNaN(n)) return;
    this._current = this._round(n / 100).toString();
  }

  /** Evaluate the expression (= button). Returns result string or null. */
  compute() {
    if (this._error || this._current === '' || this._previous === '' || !this._op) return null;
    const snapshot = { expr: `${this._previous} ${this._op} ${this._current}` };
    this._evaluate();
    if (this._error) return null;
    return { ...snapshot, result: this._current };
  }

  /** Remove the last character of the current operand. */
  deleteLast() {
    if (this._error) { this._reset(); return; }
    this._current = this._current.slice(0, -1);
  }

  /** Full reset. */
  allClear() {
    this._reset();
  }

  // ── Formatting ────────────────────────────────────────────────

  /**
   * Format a numeric string with locale thousands-separator,
   * preserving any trailing decimal and digits the user typed.
   */
  format(raw) {
    if (!raw || raw === '-' || raw === '0.') return raw || '0';
    const [intPart, decPart] = raw.split('.');
    const int = parseFloat(intPart);
    if (isNaN(int)) return raw;
    const formatted = int.toLocaleString('en');
    return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
  }

  /** Returns display-ready values. */
  getDisplay() {
    if (this._error) return { current: this._error, expression: '', isError: true };

    const current    = this._current === '' ? '0' : this.format(this._current);
    let   expression = '';
    if (this._previous !== '') {
      expression = `${this.format(this._previous)}${this._op ? ' ' + this._op : ''}`;
    }

    return { current, expression, isError: false };
  }

  // ── Private helpers ──────────────────────────────────────────

  _reset() {
    this._current  = '';
    this._previous = '';
    this._op       = null;
    this._error    = null;
  }

  _evaluate() {
    const a = parseFloat(this._previous);
    const b = parseFloat(this._current);
    if (isNaN(a) || isNaN(b)) return;

    let result;
    switch (this._op) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '×': result = a * b; break;
      case '÷':
        if (b === 0) {
          this._error    = "Can't divide by zero";
          this._op       = null;
          this._current  = '';
          this._previous = '';
          return;
        }
        result = a / b;
        break;
      default: return;
    }

    this._current  = this._round(result).toString();
    this._previous = '';
    this._op       = null;
  }

  /** Fix floating-point drift (e.g. 0.1 + 0.2 = 0.3). */
  _round(n) {
    return Math.round(n * 1e12) / 1e12;
  }
}

// ================================================================
// 2. CALC HISTORY — Manages history with localStorage persistence
// ================================================================

class CalcHistory {
  constructor(maxItems = 30) {
    this._max   = maxItems;
    this._items = this._load();
  }

  get items() { return [...this._items]; }

  push(expr, result) {
    this._items.unshift({ expr, result, id: Date.now() });
    if (this._items.length > this._max) this._items.pop();
    this._save();
  }

  clear() {
    this._items = [];
    this._save();
  }

  _save() {
    try { localStorage.setItem('calc_history', JSON.stringify(this._items)); } catch {}
  }

  _load() {
    try { return JSON.parse(localStorage.getItem('calc_history')) || []; } catch { return []; }
  }
}

// ================================================================
// 3. CALC UI — DOM bindings, animations, and display management
// ================================================================

class CalcUI {
  /**
   * @param {CalcEngine}  engine
   * @param {CalcHistory} history
   */
  constructor(engine, history) {
    this._engine  = engine;
    this._history = history;

    // ── DOM refs ──────────────────────────────────────────────
    this._elCurrent    = document.getElementById('display-current');
    this._elExpression = document.getElementById('display-expression');
    this._elHistPanel  = document.getElementById('history-panel');
    this._elHistList   = document.getElementById('history-list');
    this._elHistBtn    = document.getElementById('btn-history');
    this._elThemeBtn   = document.getElementById('btn-theme');

    // ── State ─────────────────────────────────────────────────
    this._histOpen     = false;
    this._activeOpBtn  = null;

    // ── Bootstrap ─────────────────────────────────────────────
    this._applyTheme(this._savedTheme());
    this._bindButtons();
    this._bindKeyboard();
    this._renderHistory();
    this._updateDisplay();
  }

  // ── Event binding ─────────────────────────────────────────────

  _bindButtons() {
    const keypad = document.querySelector('.keypad');

    keypad.addEventListener('click', (e) => {
      const key = e.target.closest('.key');
      if (!key) return;

      this._animateKey(key);

      // Number / decimal
      if (key.dataset.num !== undefined) {
        this._clearOpHighlight();
        this._engine.inputDigit(key.dataset.num);
        this._updateDisplay();
        return;
      }

      // Operator
      if (key.dataset.op) {
        this._engine.inputOperator(key.dataset.op);
        this._highlightOp(key);
        this._updateDisplay();
        return;
      }

      // Actions
      switch (key.dataset.action) {
        case 'clear':
          this._engine.allClear();
          this._clearOpHighlight();
          this._updateDisplay();
          break;

        case 'delete':
          this._engine.deleteLast();
          this._updateDisplay();
          break;

        case 'percent':
          this._engine.inputPercent();
          this._updateDisplay();
          break;

        case 'equals':
          this._doEquals();
          break;
      }
    });

    // History toggle
    this._elHistBtn.addEventListener('click', () => this._toggleHistory());

    // Theme toggle
    this._elThemeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      this._applyTheme(next);
    });

    // Clear history
    document.getElementById('btn-clear-history').addEventListener('click', () => {
      this._history.clear();
      this._renderHistory();
    });
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Special hotkeys
      if (e.key === 'h' || e.key === 'H') { this._toggleHistory(); return; }
      if (e.key === 't' || e.key === 'T') {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        this._applyTheme(next);
        return;
      }
      if (this._histOpen) { if (e.key === 'Escape') this._toggleHistory(); return; }

      const preventKeys = ['/', '*', '+', 'Enter', 'Backspace', 'Delete'];
      if (preventKeys.includes(e.key)) e.preventDefault();

      const digit = e.key;
      if ((digit >= '0' && digit <= '9') || digit === '.') {
        this._clearOpHighlight();
        this._engine.inputDigit(digit);
        this._updateDisplay();
        this._flashKey(`[data-num="${digit}"]`);
        return;
      }

      const opMap = { '+': '+', '-': '-', '*': '×', '/': '÷' };
      if (opMap[e.key]) {
        this._engine.inputOperator(opMap[e.key]);
        const opBtn = document.querySelector(`[data-op="${opMap[e.key]}"]`);
        if (opBtn) this._highlightOp(opBtn);
        this._updateDisplay();
        return;
      }

      switch (e.key) {
        case '%':      this._engine.inputPercent(); this._updateDisplay(); break;
        case 'Enter':  case '=': this._doEquals(); break;
        case 'Backspace': case 'Delete': this._engine.deleteLast(); this._updateDisplay(); break;
        case 'Escape': this._engine.allClear(); this._clearOpHighlight(); this._updateDisplay(); break;
      }
    });
  }

  // ── Actions ───────────────────────────────────────────────────

  _doEquals() {
    const record = this._engine.compute();
    this._clearOpHighlight();
    this._updateDisplay();
    if (record) {
      this._history.push(record.expr, record.result);
      this._renderHistory();
    }
  }

  // ── Display ───────────────────────────────────────────────────

  _updateDisplay() {
    const { current, expression, isError } = this._engine.getDisplay();

    this._elExpression.textContent = expression;
    this._elCurrent.textContent    = current;
    this._elCurrent.classList.toggle('is-error', isError);

    // Dynamic font scaling based on length
    const len = current.length;
    let size = '3.2rem';
    if (len > 16) size = '1.5rem';
    else if (len > 12) size = '2rem';
    else if (len > 9)  size = '2.5rem';
    this._elCurrent.style.fontSize = isError ? '' : size;
  }

  // ── History panel ─────────────────────────────────────────────

  _toggleHistory() {
    this._histOpen = !this._histOpen;
    this._elHistPanel.classList.toggle('open', this._histOpen);
    this._elHistPanel.setAttribute('aria-hidden', String(!this._histOpen));
    this._elHistBtn.setAttribute('aria-expanded', String(this._histOpen));
  }

  _renderHistory() {
    const items = this._history.items;
    this._elHistList.innerHTML = '';

    if (!items.length) {
      this._elHistList.innerHTML = '<li class="history-empty">No calculations yet</li>';
      return;
    }

    items.forEach(({ expr, result }) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.setAttribute('role', 'listitem');
      li.innerHTML = `
        <div class="history-item-expr">${expr} =</div>
        <div class="history-item-result">${this._engine.format(result)}</div>
      `;
      // Tap to restore result into current operand
      li.addEventListener('click', () => {
        this._engine.allClear();
        // Seed the engine with the historical result
        result.toString().split('').forEach(ch => this._engine.inputDigit(ch));
        this._updateDisplay();
        this._toggleHistory();
      });
      this._elHistList.appendChild(li);
    });
  }

  // ── Operator highlight ────────────────────────────────────────

  _highlightOp(btn) {
    this._clearOpHighlight();
    btn.classList.add('active');
    this._activeOpBtn = btn;
  }

  _clearOpHighlight() {
    if (this._activeOpBtn) {
      this._activeOpBtn.classList.remove('active');
      this._activeOpBtn = null;
    }
  }

  // ── Animations ────────────────────────────────────────────────

  _animateKey(el) {
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.91)' }, { transform: 'scale(1)' }],
      { duration: 180, easing: 'cubic-bezier(0.25,0.8,0.25,1)' }
    );
  }

  _flashKey(selector) {
    const el = document.querySelector(selector);
    if (el) this._animateKey(el);
  }

  // ── Theme ─────────────────────────────────────────────────────

  _applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('calc_theme', theme); } catch {}
  }

  _savedTheme() {
    try { return localStorage.getItem('calc_theme') || 'dark'; } catch { return 'dark'; }
  }
}

// ================================================================
// 4. INIT
// ================================================================

function init() {
  if (!document.getElementById('display-current')) return; // Guard: must have HTML

  const engine  = new CalcEngine();
  const history = new CalcHistory(30);
  new CalcUI(engine, history); // UI orchestrates everything
}

document.addEventListener('DOMContentLoaded', init);

export { CalcEngine, CalcHistory, CalcUI };
