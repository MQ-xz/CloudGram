from kivymd.app import MDApp
from kivy.core.window import Window
from src.screens import screens


class CloudFreeApp(MDApp):
    def build(self):
        Window.size = (320, 600)
        return screens()


if __name__ == "__main__":
    CloudFreeApp().run()
