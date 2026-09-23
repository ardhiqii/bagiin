import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * shadcn Button, adapted to Bagiin's existing tokenized CSS system.
 * Keep the shadcn variant API, but map it to our warm-neutral surfaces,
 * radius scale, and contrast-safe accent tokens instead of Tailwind defaults.
 */
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-primary",
      primary: "btn-primary",
      destructive: "btn-danger",
      danger: "btn-danger",
      outline: "btn-outline",
      secondary: "btn-outline",
      ghost: "btn-ghost",
      success: "btn-success",
      link: "link-button",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "",
      icon: "btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
