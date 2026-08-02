import type { App, Component } from 'vue'
import { createApp } from 'vue'
import mainStyles from '@/styles/main.css?inline'

/** 挂载结果 */
export interface ShadowMount {
  /** 插入到行内的容器，卸载时需移除 */
  container: HTMLElement
  /** Vue 应用实例 */
  app: App
}

/**
 * 在行内挂一个隔离样式的 Vue 组件
 *
 * 用 shadow DOM 装载，避免 115 的 Tailwind 与脚本自身样式互相污染——
 * 新版整站就是 Tailwind，不隔离几乎必然打架。
 * @param host 插入位置
 * @param component 组件
 * @param props 组件 props
 * @returns 挂载结果，卸载时先 unmount 再移除 container
 */
export function mountInShadow(
  host: HTMLElement,
  component: Component,
  props: Record<string, unknown>,
): ShadowMount {
  const container = document.createElement('div')
  container.style.width = '100%'
  host.appendChild(container)

  const shadowRoot = container.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = mainStyles
  shadowRoot.appendChild(style)

  const root = document.createElement('div')
  root.setAttribute('data-theme', 'light')
  shadowRoot.appendChild(root)

  const app = createApp(component, props)
  app.mount(root)

  return { container, app }
}

/**
 * 卸载
 * @param mounted 挂载结果
 */
export function unmountShadow(mounted: ShadowMount): void {
  mounted.app.unmount()
  mounted.container.remove()
}
