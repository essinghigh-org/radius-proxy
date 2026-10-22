const form = document.querySelector('form')
const button = form.querySelector('button')
const status = document.querySelector('#status')
form.addEventListener('submit', async event => {
  event.preventDefault()
  if (button.disabled) return
  button.disabled = true
  button.textContent = 'Authenticating…'
  status.textContent = ''
  const timer = setTimeout(() => { status.textContent = 'Check your phone for an MFA prompt!' }, 2000)
  try {
    const body = new FormData(form)
    body.set('accept', 'json')
    const response = await fetch(form.action, { method: 'POST', body, redirect: 'error' })
    const result = await response.json()
    if (!response.ok || !result.redirect) throw new Error('Authentication failed. Please check your credentials and try again.')
    window.location.assign(result.redirect)
  } catch {
    status.textContent = 'Authentication failed. Please check your credentials and try again.'
  } finally {
    clearTimeout(timer)
    form.elements.password.value = ''
    button.disabled = false
    button.textContent = 'Login'
  }
})
