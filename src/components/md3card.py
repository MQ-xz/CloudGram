"""md3card"""
from kivymd.uix.card import MDCard
from kivy.properties import StringProperty


class MD3Card(MDCard):
    """Implements a material design v3 card."""

    text = StringProperty()
