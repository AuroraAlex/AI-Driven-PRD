/**
 * MarkdownMessage — chat message bubble; thin wrapper over MarkdownPreview
 * with `trackOffsets` enabled so DOM selections can be mapped back to
 * source-markdown offsets for the "export selection" feature.
 */
import { memo } from 'react'
import MarkdownPreview from '../markdown/MarkdownPreview'

interface Props {
  content: string
  /** Optional dom id used by the selection-export logic to scope the range. */
  scopeId?: string
}

function MarkdownMessageImpl({ content, scopeId }: Props) {
  return (
    <div data-md-scope={scopeId ?? ''} data-md-source={content}>
      <MarkdownPreview content={content} trackOffsets />
    </div>
  )
}

export default memo(MarkdownMessageImpl)
