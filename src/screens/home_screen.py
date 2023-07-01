"""Home Screen"""
from kivymd.uix.screen import MDScreen
from kivymd.uix.label import MDLabel
from kivymd.uix.button import MDFloatingActionButtonSpeedDial

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
        self.ids.home_layout.add_widget(self.button())

    def add_new_file(self, file):
        "Add new file"
        _data = {"name": "new File", "type": "file"}
        data.append(_data)

    def add_new_folder(self, folder):
        "Add new folder"
        _data = {"name": "new Folder", "type": "folder"}
        data.append(_data)

    def button(self):
        "Button"
        return MDFloatingActionButtonSpeedDial(
            data={"File": "file", "Folder": "folder"}
        )
