from kivymd.app import MDApp
from kivymd.uix.label import MDLabel


class CloudFreeApp(MDApp):
    def build(self):
        return MDLabel(text="Hello, World", halign="center")


if __name__ == "__main__":
    CloudFreeApp().run()
