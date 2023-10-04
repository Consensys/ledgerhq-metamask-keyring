import "eth-sig-util";

declare module "eth-sig-util" {
  interface MessageTypeProperty {
    name: string;
    type: string;
  }
  interface MessageTypes {
    EIP712Domain: MessageTypeProperty[];
    [additionalProperties: string]: MessageTypeProperty[];
  }
}
