import React from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import type { TextInputProps } from 'react-native';
import { Field } from './ui';

/** react-hook-form Controller + themed Field. Error text is an i18n key from the zod schema. */
export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  left,
  right,
  hint,
  ...input
}: TextInputProps & { control: Control<T>; name: Path<T>; label: string; left?: string; right?: React.ReactNode; hint?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          left={left}
          right={right}
          hint={hint}
          value={(field.value as string) ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          {...input}
        />
      )}
    />
  );
}
