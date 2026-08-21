import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 渲染前应用本地记住的主题与强调色，避免首帧闪烁（配置异步加载后会再次同步）
const saved = localStorage.getItem('vs-theme')
if (saved === 'light' || saved === 'dark') {
  document.documentElement.dataset.theme = saved
}
const savedAccent = localStorage.getItem('vs-accent')
document.documentElement.dataset.accent = savedAccent === 'blue' ? 'blue' : 'orange'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
