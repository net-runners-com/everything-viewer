// Frame-side copies of the worker's types (the frame must not import Node modules).
export type OutKind = 'pdf' | 'glb'
export type ToolErrorKind = 'not_found' | 'failed' | 'timeout' | 'bad_request'
