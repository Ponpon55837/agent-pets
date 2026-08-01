export function formatProject(project?: string): string {
  if (!project) return ''
  const parts = project.split(/[/\\]/)
  return parts[parts.length - 1] || project
}
