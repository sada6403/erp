import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {describe,it,expect,afterEach} from 'vitest'
import PasswordInput from './PasswordInput'
afterEach(cleanup)
describe('password masking',()=>{
 it('starts hidden, toggles only on the eye click and keeps each field independent',()=>{
  render(<><PasswordInput aria-label="Password" defaultValue="a-secret"/><PasswordInput aria-label="Confirm" defaultValue="a-secret"/></>)
  expect(screen.getByLabelText('Password')).toHaveAttribute('type','password');expect(screen.getByLabelText('Confirm')).toHaveAttribute('type','password')
  fireEvent.click(screen.getAllByLabelText('Show password')[0]);expect(screen.getByLabelText('Password')).toHaveAttribute('type','text');expect(screen.getByLabelText('Confirm')).toHaveAttribute('type','password')
  fireEvent.click(screen.getByLabelText('Hide password'));expect(screen.getByLabelText('Password')).toHaveAttribute('type','password')
 })
})
