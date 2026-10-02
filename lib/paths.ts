export const basePath = "/timelog"

export function apiPath(path: `/${string}`) {
  return `${basePath}${path}`
}
