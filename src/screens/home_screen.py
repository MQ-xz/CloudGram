"""Home Screen"""
from kivymd.uix.screen import MDScreen
from kivymd.uix.label import MDLabel

from src.components.file_upload import FileUploader

data = [
    {
        "name": "My photos",
        "type": "folder",
    },
    {
        "name": "My videos",
        "type": "folder",
    },
    {
        "name": "IMG_110.png",
        "type": "file",
    },
]


class HomeScreen(MDScreen):
    """Home"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        for _data in data:
            file = MDLabel(
                text=_data["name"],
                halign="center",
                theme_text_color="Primary",
                size_hint=(1, None),
                height="150dp",
                padding=10,
            )
            self.ids.files.add_widget(file)

        self.ids.home_layout.add_widget(FileUploader())
