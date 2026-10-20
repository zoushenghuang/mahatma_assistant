import { Button as AntButton, type ButtonProps as AntButtonProps } from 'antd';

/**
 * antd Button 的语义封装：把业务里的 variant 映射到 antd 的 type / danger，
 * 避免每个调用点都记 `type="text"`、`danger` 这些细节。
 */
export type ButtonVariant = 'primary' | 'default' | 'text' | 'link' | 'danger';

export interface ButtonProps extends Omit<AntButtonProps, 'type' | 'danger' | 'variant'> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'default', ...rest }: ButtonProps) {
  const type =
    variant === 'primary'
      ? 'primary'
      : variant === 'text'
        ? 'text'
        : variant === 'link'
          ? 'link'
          : 'default';

  return <AntButton type={type} danger={variant === 'danger'} {...rest} />;
}
